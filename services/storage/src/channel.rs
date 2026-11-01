use super::*;

impl<S: Checkpoint> Store<S> {
    pub fn channel_connections(&self, channel_type: &str) -> Result<Vec<ChannelConfig>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT connection_id, channel_type, region, enabled, app_id_hint
                 FROM channel_connections WHERE channel_type = ?1 ORDER BY connection_id",
            )
            .map_err(|error| format!("prepare {channel_type} connections query: {error}"))?;
        let rows = statement
            .query_map([channel_type], |row| {
                Ok(ChannelConfig {
                    connection_id: row.get(0)?,
                    channel_type: row.get(1)?,
                    region: row.get(2)?,
                    enabled: row.get::<_, i64>(3)? != 0,
                    app_id_hint: row.get(4)?,
                })
            })
            .map_err(|error| format!("query {channel_type} connections: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read {channel_type} connections: {error}"))
    }

    pub fn channel_config(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<ChannelConfig>, String> {
        self.connection
            .query_row(
                "SELECT connection_id, channel_type, region, enabled, app_id_hint
                 FROM channel_connections WHERE channel_type = ?1 AND connection_id = ?2",
                params![channel_type, connection_id],
                |row| {
                    Ok(ChannelConfig {
                        connection_id: row.get(0)?,
                        channel_type: row.get(1)?,
                        region: row.get(2)?,
                        enabled: row.get::<_, i64>(3)? != 0,
                        app_id_hint: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| {
                format!("load {channel_type}/{connection_id} channel configuration: {error}")
            })
    }

    pub fn save_channel_config(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        region: &str,
        enabled: bool,
        app_id_hint: &str,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO channel_connections(
                   channel_type, connection_id, region, enabled, app_id_hint
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(channel_type, connection_id) DO UPDATE SET
                   region = excluded.region, enabled = excluded.enabled,
                   app_id_hint = excluded.app_id_hint, updated_at = CURRENT_TIMESTAMP",
                params![
                    channel_type,
                    connection_id,
                    region,
                    i64::from(enabled),
                    app_id_hint
                ],
            )
            .map(|_| ())
            .map_err(|error| {
                format!("save {channel_type}/{connection_id} channel configuration: {error}")
            })
    }

    pub fn channel_event_seen(
        &self,
        channel_type: &str,
        connection_id: &str,
        event_id: &str,
    ) -> Result<bool, String> {
        self.connection
            .query_row(
                "SELECT 1 FROM channel_inbox
                 WHERE channel_type = ?1 AND connection_id = ?2 AND event_id = ?3",
                params![channel_type, connection_id, event_id],
                |_| Ok(()),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(|error| format!("check channel inbox deduplication: {error}"))
    }

    pub fn channel_thread_target(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<String>, String> {
        self.connection.query_row("SELECT workspace_thread_id FROM channel_thread_targets WHERE channel_type = ?1 AND connection_id = ?2", params![channel_type, connection_id], |row| row.get(0)).optional().map_err(|error| format!("read channel Thread target: {error}"))
    }
    pub fn set_channel_thread_target(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<(), String> {
        if let Some(thread_id) = thread_id {
            self.connection.execute("INSERT INTO channel_thread_targets(channel_type, connection_id, workspace_thread_id) VALUES(?1, ?2, ?3) ON CONFLICT(channel_type, connection_id) DO UPDATE SET workspace_thread_id = excluded.workspace_thread_id", params![channel_type, connection_id, thread_id])
        } else {
            self.connection.execute("DELETE FROM channel_thread_targets WHERE channel_type = ?1 AND connection_id = ?2", params![channel_type, connection_id])
        }.map(|_| ()).map_err(|error| format!("save channel Thread target: {error}"))
    }
    pub fn channel_thread_id(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT workspace_thread_id FROM channel_bindings
                 WHERE channel_type = ?1 AND connection_id = ?2 AND conversation_key = ?3",
                params![channel_type, connection_id, conversation_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("resolve channel conversation binding: {error}"))
    }

    pub fn commit_channel_inbound(
        &mut self,
        workspace: &S,
        inbound: &ChannelInbound<'_>,
    ) -> Result<bool, String> {
        let state_json = serde_json::to_string(workspace)
            .map_err(|error| format!("encode Ovule state: {error}"))?;
        let payload_json = serde_json::to_string(&serde_json::json!({
            "channel": inbound.channel_type,
            "connection": inbound.connection_id,
            "conversation": inbound.conversation_id,
            "event": inbound.event_id,
        }))
        .map_err(|error| format!("encode channel event: {error}"))?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("begin channel inbox transaction: {error}"))?;
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO channel_inbox(
                   channel_type, connection_id, event_id, conversation_key, platform_message_id,
                   sender_id, attempt_id, status
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing')",
                params![
                    inbound.channel_type,
                    inbound.connection_id,
                    inbound.event_id,
                    inbound.conversation_key,
                    inbound.platform_message_id,
                    inbound.sender_id,
                    inbound.attempt_id
                ],
            )
            .map_err(|error| format!("append channel inbox item: {error}"))?;
        if inserted == 0 {
            return Ok(false);
        }
        transaction
            .execute(
                "INSERT INTO channel_bindings(
                   channel_type, connection_id, conversation_key, conversation_id, conversation_type,
                   platform_thread_id, workspace_thread_id
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(channel_type, connection_id, conversation_key) DO UPDATE SET
                   workspace_thread_id = excluded.workspace_thread_id,
                   conversation_id = excluded.conversation_id,
                   conversation_type = excluded.conversation_type,
                   platform_thread_id = excluded.platform_thread_id,
                   updated_at = CURRENT_TIMESTAMP",
                params![
                    inbound.channel_type,
                    inbound.connection_id,
                    inbound.conversation_key,
                    inbound.conversation_id,
                    inbound.conversation_type,
                    inbound.platform_thread_id,
                    inbound.workspace_thread_id
                ],
            )
            .map_err(|error| format!("persist channel conversation binding: {error}"))?;
        persist_workspace_event(
            &transaction,
            workspace,
            &state_json,
            "channel/message-received",
            Some(inbound.attempt_id),
            &payload_json,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("commit channel inbox transaction: {error}"))?;
        Ok(true)
    }

    pub fn channel_reply_route(
        &self,
        attempt_id: &str,
    ) -> Result<Option<ChannelReplyRoute>, String> {
        self.connection
            .query_row(
                "SELECT inbox.channel_type, inbox.connection_id, binding.conversation_key,
                        binding.conversation_id, binding.conversation_type,
                        binding.platform_thread_id, binding.workspace_thread_id,
                        inbox.platform_message_id
                 FROM channel_inbox inbox
                 JOIN channel_bindings binding
                   ON binding.channel_type = inbox.channel_type
                  AND binding.connection_id = inbox.connection_id
                  AND binding.conversation_key = inbox.conversation_key
                 WHERE inbox.attempt_id = ?1",
                [attempt_id],
                |row| {
                    Ok(ChannelReplyRoute {
                        channel_type: row.get(0)?,
                        connection_id: row.get(1)?,
                        conversation_key: row.get(2)?,
                        conversation_id: row.get(3)?,
                        conversation_type: row.get(4)?,
                        platform_thread_id: row.get(5)?,
                        workspace_thread_id: row.get(6)?,
                        reply_to_message_id: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("resolve channel reply route: {error}"))
    }

    pub fn channel_subscription(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<ChannelSubscription>, String> {
        self.connection
            .query_row(
                "SELECT subscription_id, channel_type, connection_id, conversation_key,
                        conversation_id, platform_thread_id, workspace_thread_id, label, active,
                        (SELECT MAX(sequence) FROM channel_feed
                         WHERE subscription_id = channel_subscriptions.subscription_id)
                 FROM channel_subscriptions
                 WHERE channel_type = ?1 AND connection_id = ?2 AND conversation_key = ?3",
                params![channel_type, connection_id, conversation_key],
                channel_subscription_from_row,
            )
            .optional()
            .map_err(|error| format!("resolve channel subscription: {error}"))
    }

    pub fn subscribe_channel_for_attempt(
        &mut self,
        attempt_id: &str,
        label: &str,
    ) -> Result<ChannelSubscription, String> {
        let route = self.channel_reply_route(attempt_id)?.ok_or_else(|| {
            "The current Attempt did not originate from a channel conversation".to_owned()
        })?;
        if route.conversation_type != "group" {
            return Err(
                "Only a channel group conversation can become a feedback subscription".to_owned(),
            );
        }
        let subscription_id = channel_subscription_id(
            &route.channel_type,
            &route.connection_id,
            &route.conversation_key,
        );
        self.connection
            .execute(
                "INSERT INTO channel_subscriptions(
                   subscription_id, channel_type, connection_id, conversation_key, conversation_id,
                   platform_thread_id, workspace_thread_id, label, active
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
                 ON CONFLICT(channel_type, connection_id, conversation_key) DO UPDATE SET
                   workspace_thread_id = excluded.workspace_thread_id,
                   label = excluded.label, active = 1, updated_at = CURRENT_TIMESTAMP",
                params![
                    &subscription_id,
                    route.channel_type,
                    route.connection_id,
                    route.conversation_key,
                    route.conversation_id,
                    route.platform_thread_id,
                    route.workspace_thread_id,
                    label
                ],
            )
            .map_err(|error| format!("subscribe channel conversation: {error}"))?;
        self.channel_subscription(
            &route.channel_type,
            &route.connection_id,
            &route.conversation_key,
        )?
        .ok_or_else(|| "channel subscription was not persisted".to_owned())
    }

    pub fn channel_subscriptions(
        &self,
        workspace_thread_id: &str,
    ) -> Result<Vec<ChannelSubscription>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT subscription_id, channel_type, connection_id, conversation_key,
                        conversation_id, platform_thread_id, workspace_thread_id, label, active,
                        (SELECT MAX(sequence) FROM channel_feed
                         WHERE subscription_id = channel_subscriptions.subscription_id)
                 FROM channel_subscriptions WHERE workspace_thread_id = ?1
                 ORDER BY created_at, subscription_id",
            )
            .map_err(|error| format!("prepare channel subscription query: {error}"))?;
        statement
            .query_map([workspace_thread_id], channel_subscription_from_row)
            .map_err(|error| format!("query channel subscriptions: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read channel subscriptions: {error}"))
    }

    pub fn set_channel_subscription_active(
        &mut self,
        workspace_thread_id: &str,
        subscription_id: &str,
        active: bool,
    ) -> Result<ChannelSubscription, String> {
        let changed = self
            .connection
            .execute(
                "UPDATE channel_subscriptions SET active = ?3, updated_at = CURRENT_TIMESTAMP
                 WHERE workspace_thread_id = ?1 AND subscription_id = ?2",
                params![workspace_thread_id, subscription_id, i64::from(active)],
            )
            .map_err(|error| format!("update channel subscription: {error}"))?;
        if changed == 0 {
            return Err(format!("unknown channel subscription: {subscription_id}"));
        }
        self.channel_subscriptions(workspace_thread_id)?
            .into_iter()
            .find(|subscription| subscription.subscription_id == subscription_id)
            .ok_or_else(|| format!("unknown channel subscription: {subscription_id}"))
    }

    pub fn append_channel_feed(
        &mut self,
        inbound: &ChannelFeedInbound<'_>,
    ) -> Result<bool, String> {
        self.connection
            .execute(
                "INSERT OR IGNORE INTO channel_feed(
                   subscription_id, channel_type, connection_id, event_id, conversation_key,
                   conversation_id, platform_thread_id, platform_message_id, sender_id,
                   sender_name, content, content_type, platform_created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    inbound.subscription_id,
                    inbound.channel_type,
                    inbound.connection_id,
                    inbound.event_id,
                    inbound.conversation_key,
                    inbound.conversation_id,
                    inbound.platform_thread_id,
                    inbound.platform_message_id,
                    inbound.sender_id,
                    inbound.sender_name,
                    inbound.content,
                    inbound.content_type,
                    inbound.platform_created_at
                ],
            )
            .map(|inserted| inserted != 0)
            .map_err(|error| format!("append channel feed item: {error}"))
    }

    pub fn channel_feed(
        &self,
        workspace_thread_id: &str,
        subscription_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<ChannelFeedItem>, String> {
        if !self
            .channel_subscriptions(workspace_thread_id)?
            .iter()
            .any(|subscription| subscription.subscription_id == subscription_id)
        {
            return Err(format!("unknown channel subscription: {subscription_id}"));
        }
        let mut statement = self
            .connection
            .prepare(
                "SELECT sequence, subscription_id, connection_id, conversation_id,
                        platform_thread_id, platform_message_id, sender_id, sender_name, content,
                        content_type, platform_created_at
                 FROM channel_feed WHERE subscription_id = ?1 AND sequence > ?2
                 ORDER BY sequence LIMIT ?3",
            )
            .map_err(|error| format!("prepare channel feed query: {error}"))?;
        statement
            .query_map(
                params![
                    subscription_id,
                    after_sequence,
                    i64::try_from(limit).unwrap_or(100)
                ],
                |row| {
                    Ok(ChannelFeedItem {
                        sequence: row.get(0)?,
                        subscription_id: row.get(1)?,
                        connection_id: row.get(2)?,
                        conversation_id: row.get(3)?,
                        platform_thread_id: row.get(4)?,
                        platform_message_id: row.get(5)?,
                        sender_id: row.get(6)?,
                        sender_name: row.get(7)?,
                        content: row.get(8)?,
                        content_type: row.get(9)?,
                        platform_created_at: row.get(10)?,
                    })
                },
            )
            .map_err(|error| format!("query channel feed: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read channel feed: {error}"))
    }

    pub fn commit_with_channel_reply(
        &mut self,
        workspace: &S,
        kind: &str,
        attempt_id: &str,
        payload: &serde_json::Value,
        route: &ChannelReplyRoute,
        body: &str,
    ) -> Result<(), String> {
        let state_json = serde_json::to_string(workspace)
            .map_err(|error| format!("encode Ovule state: {error}"))?;
        let payload_json = serde_json::to_string(payload)
            .map_err(|error| format!("encode Ovule event: {error}"))?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("begin channel reply transaction: {error}"))?;
        persist_workspace_event(
            &transaction,
            workspace,
            &state_json,
            kind,
            Some(attempt_id),
            &payload_json,
        )?;
        transaction
            .execute(
                "UPDATE channel_inbox SET status = 'completed', error = NULL,
                   updated_at = CURRENT_TIMESTAMP WHERE attempt_id = ?1",
                [attempt_id],
            )
            .map_err(|error| format!("complete channel inbox item: {error}"))?;
        transaction
            .execute(
                "INSERT INTO channel_outbox(
                   delivery_id, channel_type, connection_id, attempt_id, conversation_id,
                   platform_thread_id, reply_to_message_id, body, status
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued')
                 ON CONFLICT(attempt_id) DO NOTHING",
                params![
                    format!(
                        "{}:{}:{attempt_id}",
                        route.channel_type, route.connection_id
                    ),
                    route.channel_type,
                    route.connection_id,
                    attempt_id,
                    route.conversation_id,
                    route.platform_thread_id,
                    route.reply_to_message_id,
                    body
                ],
            )
            .map_err(|error| format!("enqueue channel reply: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit channel reply transaction: {error}"))
    }

    pub fn pending_channel_deliveries(
        &self,
        channel_type: &str,
        connection_id: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<PendingDelivery>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT delivery_id, conversation_id, platform_thread_id,
                        reply_to_message_id, body, attempts
                 FROM channel_outbox
                 WHERE channel_type = ?1 AND connection_id = ?2
                   AND status IN ('queued', 'retry') AND next_attempt_at_ms <= ?3
                 ORDER BY created_at, delivery_id LIMIT ?4",
            )
            .map_err(|error| format!("prepare channel outbox query: {error}"))?;
        let rows = statement
            .query_map(
                params![
                    channel_type,
                    connection_id,
                    now_ms,
                    i64::try_from(limit).unwrap_or(i64::MAX)
                ],
                |row| {
                    Ok(PendingDelivery {
                        delivery_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        platform_thread_id: row.get(2)?,
                        reply_to_message_id: row.get(3)?,
                        body: row.get(4)?,
                        attempts: row.get(5)?,
                    })
                },
            )
            .map_err(|error| format!("query channel outbox: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read channel outbox: {error}"))
    }

    pub fn mark_channel_delivery_sent(
        &mut self,
        delivery_id: &str,
        platform_message_id: &str,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE channel_outbox SET status = 'sent', attempts = attempts + 1,
                   platform_message_id = ?2, error = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE delivery_id = ?1",
                params![delivery_id, platform_message_id],
            )
            .map(|_| ())
            .map_err(|error| format!("complete channel delivery: {error}"))
    }

    pub fn mark_channel_delivery_failed(
        &mut self,
        delivery_id: &str,
        error: &str,
        next_attempt_at_ms: i64,
        terminal: bool,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE channel_outbox SET status = ?2, attempts = attempts + 1,
                   error = ?3, next_attempt_at_ms = ?4, updated_at = CURRENT_TIMESTAMP
                 WHERE delivery_id = ?1",
                params![
                    delivery_id,
                    if terminal { "failed" } else { "retry" },
                    error.chars().take(2_000).collect::<String>(),
                    next_attempt_at_ms
                ],
            )
            .map(|_| ())
            .map_err(|database_error| format!("record channel delivery failure: {database_error}"))
    }
}
