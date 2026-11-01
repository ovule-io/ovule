use std::sync::Arc;

use ovule_remoting::backend::ComputerUseHost;
use rmcp::{
    ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router,
    transport::{
        StreamableHttpServerConfig, StreamableHttpService,
        streamable_http_server::session::local::LocalSessionManager,
    },
};
use serde_json::Value;
use tokio_util::sync::CancellationToken as TokioCancellationToken;

use ovule_hosts::ComputerUseMcpEndpoint;

const TOOL_NAME: &str = "ovule_computer_control";

use ovule_hosts::capability::computer::ComputerUse;
pub(crate) struct ComputerUseMcpServer {
    approvals: Arc<std::sync::Mutex<Arc<ovule_agent::execution::approval::ApprovalBroker>>>,
    endpoint: ComputerUseMcpEndpoint,
    cancellation: TokioCancellationToken,
}

impl ComputerUseMcpServer {
    #[allow(deprecated)]
    pub(crate) async fn start(host: &Arc<dyn ComputerUseHost>) -> Result<Self, String> {
        if !host.is_supported() {
            return Err("Tuffite CRD remoting is not available in this build".to_owned());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|error| format!("bind Computer Use MCP loopback server: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("read Computer Use MCP loopback address: {error}"))?;
        let bearer_token = format!(
            "{:016x}{:016x}{:016x}{:016x}",
            rand::random::<u64>(),
            rand::random::<u64>(),
            rand::random::<u64>(),
            rand::random::<u64>()
        );
        let cancellation = TokioCancellationToken::new();
        let facade = ComputerUse::local(host.clone());
        let approvals = Arc::new(std::sync::Mutex::new(
            ovule_agent::execution::approval::ApprovalBroker::unavailable(),
        ));
        let approvals_for_handler = approvals.clone();
        let service: StreamableHttpService<ComputerUseServerHandler, LocalSessionManager> =
            StreamableHttpService::new(
                move || {
                    Ok(ComputerUseServerHandler::new(
                        facade.clone(),
                        approvals_for_handler.clone(),
                    ))
                },
                std::sync::Arc::default(),
                StreamableHttpServerConfig::default()
                    .with_sse_keep_alive(None)
                    .with_cancellation_token(cancellation.child_token()),
            );
        let router = axum::Router::new()
            .nest_service("/mcp", service)
            .layer(tower_http::validate_request::ValidateRequestHeaderLayer::bearer(&bearer_token));
        let shutdown = cancellation.clone();
        tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
                .await
            {
                tracing::warn!(%error, "Computer Use MCP loopback server stopped");
            }
        });
        Ok(Self {
            approvals,
            endpoint: ComputerUseMcpEndpoint {
                url: format!("http://{address}/mcp"),
                bearer_token,
            },
            cancellation,
        })
    }

    pub(crate) fn set_approvals(
        &self,
        broker: Arc<ovule_agent::execution::approval::ApprovalBroker>,
    ) {
        *self
            .approvals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = broker;
    }

    pub(crate) fn endpoint(&self) -> ComputerUseMcpEndpoint {
        self.endpoint.clone()
    }
}

impl Drop for ComputerUseMcpServer {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(in crate::agent_host) struct ComputerControlRequest {
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    button: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usb_keycode: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(
        description = "Required for key actions: true is key-down, false is key-up. Release every pressed key and modifier."
    )]
    pressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screen_id: Option<i64>,
}

#[derive(Clone)]
struct ComputerUseServerHandler {
    facade: ComputerUse,
    approvals: Arc<std::sync::Mutex<Arc<ovule_agent::execution::approval::ApprovalBroker>>>,
    tool_router: ToolRouter<Self>,
}

impl ComputerUseServerHandler {
    fn new(
        facade: ComputerUse,
        approvals: Arc<std::sync::Mutex<Arc<ovule_agent::execution::approval::ApprovalBroker>>>,
    ) -> Self {
        Self {
            facade,
            approvals,
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ComputerUseServerHandler {
    #[tool(
        name = "ovule_computer_control",
        description = "Capture and control the local physical desktop through Chromium Remote Desktop"
    )]
    async fn computer_control(
        &self,
        Parameters(request): Parameters<ComputerControlRequest>,
    ) -> CallToolResult {
        let arguments = serde_json::to_value(request).unwrap_or_else(|_| serde_json::json!({}));
        let broker = self
            .approvals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let execution = ovule_agent::execution::ToolExecutor::new(
            "host-computer".into(),
            processkit::CancellationToken::new(),
            broker,
            Arc::new(|_| {}),
        );
        match execution
            .run(
                TOOL_NAME,
                &arguments,
                crate::agent_host::effect_for_tool(TOOL_NAME, &arguments),
                std::time::Duration::from_secs(30),
                |_| async { self.facade.call(TOOL_NAME, &arguments).await },
            )
            .await
        {
            Ok(result) => call_tool_result(&result),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error.to_string())]),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for ComputerUseServerHandler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("CRD-backed physical desktop control provided by Ovule")
    }
}

pub(in crate::agent_host) fn call_tool_result(value: &Value) -> CallToolResult {
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("image") => Some(ContentBlock::image(
                item.get("data")?.as_str()?.to_owned(),
                item.get("mimeType")?.as_str()?.to_owned(),
            )),
            Some("text") => Some(ContentBlock::text(item.get("text")?.as_str()?.to_owned())),
            _ => None,
        })
        .collect();
    CallToolResult::success(content)
}

#[cfg(test)]
mod tests {
    use super::ComputerControlRequest;

    #[test]
    fn screenshot_request_omits_absent_optional_fields() {
        let request: ComputerControlRequest =
            serde_json::from_value(serde_json::json!({"action": "screenshot"})).unwrap();

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({"action": "screenshot"})
        );
    }
}
