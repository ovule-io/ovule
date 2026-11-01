// Generated from Mojom v0. Do not edit.
import type { MojomStructSchema, MojomCommandEntry } from 'tuffite';
export declare const mojomTypes: Readonly<Record<string, MojomStructSchema>>;
export declare const mojomMethods: readonly MojomCommandEntry[];
export interface AgentApprovalModeRequest {}
export interface AgentApprovalModeResponse {
  'result': string;
}
export interface AgentContributionView {
  'extensionId': string;
  'id': string;
  'label': string;
  'executableCandidates': string[];
  'mcpConfig': boolean;
  'requiredEnvironment': string[];
}
export interface AgentExecutionCallsRequest {
  'attemptId': string;
}
export interface AgentExecutionCallsResponse {
  'result': ExecutionCallView[];
}
export interface AgentInput {
  'id': string;
  'label': string;
  'driver': string;
  'modelId'?: string | null;
  'skillIds': string[];
  'toolIds': string[];
  'instructions': string;
  'enabled': boolean;
}
export interface AgentMarkApprovalPresentedRequest {
  'requestId': string;
}
export interface AgentMarkApprovalPresentedResponse {
  'result': boolean;
}
export interface AgentPendingApprovalsRequest {
  'attemptId': string;
}
export interface AgentPendingApprovalsResponse {
  'result': PendingApprovalView[];
}
export interface AgentRespondApprovalRequest {
  'requestId': string;
  'allow': boolean;
}
export interface AgentRespondApprovalResponse {
  'result': boolean;
}
export interface AgentRespondApprovalWithScopeRequest {
  'requestId': string;
  'allow': boolean;
  'automatic': boolean;
}
export interface AgentRespondApprovalWithScopeResponse {
  'result': boolean;
}
export interface AgentSetApprovalModeRequest {
  'mode': string;
}
export interface AgentSetApprovalModeResponse {
  'result': boolean;
}
export interface AgentView {
  'id': string;
  'label': string;
  'driver': string;
  'available': boolean;
  'enabled': boolean;
  'detail': string;
  'modelId'?: string | null;
  'skillIds': string[];
  'toolIds': string[];
  'instructions': string;
  'extensionId'?: string | null;
}
export interface AppSnapshot {
  'revision': bigint;
  'agents': AgentView[];
  'skills': SkillView[];
  'tools': ToolView[];
  'capabilities': CapabilityView[];
  'legacyDataIssues': LegacyDataIssueView[];
  'models': ModelView[];
  'projects': ProjectView[];
  'hosts': HostView[];
  'endpoints': RemoteEndpointView[];
  'bindings': WorkspaceBindingView[];
  'threads': ThreadView[];
  'messages': ThreadMessageView[];
  'goals': GoalView[];
  'nodes': NodeView[];
  'attempts': AttemptView[];
  'terminalRuns': TerminalRunView[];
}
export interface AttemptEventView {
  'kind': string;
  'occurredAt': number;
  'detail': string;
}
export interface AttemptView {
  'id': string;
  'threadId': string;
  'taskId'?: string | null;
  'sourceMessageId'?: string | null;
  'responseMessageId'?: string | null;
  'purpose': string;
  'agent': string;
  'hostId': string;
  'driver'?: string | null;
  'modelProvider'?: string | null;
  'modelRemoteId'?: string | null;
  'status': string;
  'summary': string;
  'output': string;
  'outputSequence': bigint;
  'createdAt': number;
  'startedAt'?: number | null;
  'finishedAt'?: number | null;
  'durationMs'?: number | null;
  'events': AttemptEventView[];
}
export interface BindWorkspaceInput {
  'threadId': string;
  'kind': string;
  'endpointId'?: string | null;
  'resourceId'?: string | null;
  'root': string;
  'alias': string;
}
export interface BrowserCreateFilePreviewRequest {
  'url': string;
}
export interface BrowserCreateFilePreviewResponse {
  'result': PreviewInfo;
}
export interface BrowserCreateHtmlPreviewRequest {
  'threadId': string;
  'path': string;
}
export interface BrowserCreateHtmlPreviewResponse {
  'result': PreviewInfo;
}
export interface BrowserDownloadDirectoryRequest {}
export interface BrowserDownloadDirectoryResponse {
  'result': string;
}
export interface BrowserListDownloadsRequest {}
export interface BrowserListDownloadsResponse {
  'result': DownloadView[];
}
export interface BrowserListLocalDirectoryRequest {
  'url': string;
}
export interface BrowserListLocalDirectoryResponse {
  'result': LocalFileEntry[];
}
export interface BrowserPublishDownloadRequest {
  'path': string;
  'url': string;
}
export interface BrowserPublishDownloadResponse {
  'result': DownloadView;
}
export interface BrowserReadLocalFileRequest {
  'url': string;
}
export interface BrowserReadLocalFileResponse {
  'result': WorkspaceFile;
}
export interface BrowserReadLocalTextRequest {
  'url': string;
}
export interface BrowserReadLocalTextResponse {
  'result': string;
}
export interface BrowserRemoveDownloadRequest {
  'id': string;
}
export interface BrowserRemoveDownloadResponse {
  'result': boolean;
}
export interface BrowserRespondRequest {
  'requestId': string;
  'resultJson': string;
}
export interface BrowserRespondResponse {
  'result': boolean;
}
export interface BrowserRevealDownloadRequest {
  'id': string;
}
export interface BrowserRevealDownloadResponse {
  'result': boolean;
}
export interface BrowserRevealLocalFileRequest {
  'url': string;
}
export interface BrowserRevealLocalFileResponse {
  'result': boolean;
}
export interface BrowserRevokePreviewRequest {
  'id': string;
}
export interface BrowserRevokePreviewResponse {
  'result': boolean;
}
export interface BrowserSetDownloadDirectoryRequest {
  'path': string;
}
export interface BrowserSetDownloadDirectoryResponse {
  'result': string;
}
export interface BrowserSuggestion {
  'id': string;
  'kind': string;
  'title': string;
  'detail': string;
  'target': string;
}
export interface CapabilityAgentExposureView {
  'agentId': string;
  'projection': string;
  'available': boolean;
  'detail': string;
}
export interface CapabilityView {
  'id': string;
  'label': string;
  'kind': string;
  'provider': string;
  'backend': string;
  'operations': string[];
  'scopes': string[];
  'permissions': string[];
  'health': string;
  'detail': string;
  'projections': string[];
  'agentExposures': CapabilityAgentExposureView[];
  'toolchainId'?: string | null;
  'source': string;
}
export interface ComputerUseContributionView {
  'extensionId': string;
  'id': string;
  'label': string;
  'provider': string;
  'toolchainId'?: string | null;
  'capabilities': string[];
}
export interface ContentReadHtmlPreviewRequest {
  'threadId': string;
  'path': string;
}
export interface ContentReadHtmlPreviewResponse {
  'result': HtmlPreview;
}
export interface ContentReadMarkdownRequest {
  'threadId': string;
  'path': string;
}
export interface ContentReadMarkdownResponse {
  'result': MarkdownDocument;
}
export interface ContentReadWorkspaceFileRequest {
  'threadId': string;
  'path': string;
}
export interface ContentReadWorkspaceFileResponse {
  'result': WorkspaceFile;
}
export interface ContentSaveMarkdownRequest {
  'threadId': string;
  'path': string;
  'content': string;
}
export interface ContentSaveMarkdownResponse {
  'result': MarkdownDocument;
}
export interface ContentSaveWorkspaceFileRequest {
  'threadId': string;
  'path': string;
  'bytes': Uint8Array;
}
export interface ContentSaveWorkspaceFileResponse {
  'result': WorkspaceFile;
}
export interface CreateThreadInput {
  'workspacePath'?: string | null;
}
export interface DesktopPermissions {
  'appVersion': string;
  'bundlePath'?: string | null;
  'executablePath'?: string | null;
  'signingIdentity'?: string | null;
  'otherBundlePaths': string[];
  'screenCaptureVerified': boolean;
  'inputMonitoring': boolean;
  'managed': boolean;
  'screenRecording': boolean;
  'accessibility': boolean;
  'bundleId'?: string | null;
  'expectedBundleId': string;
}
export interface DiscoverSshHostResult {
  'ready': boolean;
  'host': string;
  'port': number;
  'user': string;
  'fingerprint': string;
  'root': string;
  'alias': string;
  'detail': string;
}
export interface DownloadView {
  'id': string;
  'source': string;
  'path': string;
  'filename': string;
  'url': string;
  'bytes': bigint;
  'createdAt': bigint;
  'removed': boolean;
}
export interface ExecutionCallView {
  'callId': string;
  'attemptId': string;
  'tool': string;
  'state': string;
}
export interface ExtensionActionInput {
  'threadId'?: string | null;
  'extensionId': string;
  'actionId': string;
  'connectionId'?: string | null;
}
export interface ExtensionActionResult {
  'dataJson': string;
  'openUrl'?: string | null;
}
export interface ExtensionCapabilityView {
  'extensionId': string;
  'id': string;
  'label': string;
  'description': string;
}
export interface ExtensionCatalogView {
  'extensions': ExtensionPackageView[];
  'agents': AgentContributionView[];
  'models': ModelContributionView[];
  'capabilities': ExtensionCapabilityView[];
  'messageBlocks': MessageBlockContributionView[];
  'slashCommands': SlashCommandContributionView[];
  'computerUse': ComputerUseContributionView[];
  'fileEditors': FileEditorContributionView[];
}
export interface ExtensionOnboardingActionView {
  'requiresAuthentication': boolean;
  'id': string;
  'requiredToolchains': string[];
}
export interface ExtensionOnboardingView {
  'tag'?: string | null;
  'extensionId': string;
  'id': string;
  'label': string;
  'description': string;
  'icon': string;
  'agentIds': string[];
  'modelProvider'?: string | null;
  'inputFields': string[];
  'actions': ExtensionOnboardingActionView[];
  'allowedLinks': string[];
  'status': IntegrationStatus;
}
export interface ExtensionPackageView {
  'installPath': string;
  'id': string;
  'version': string;
  'source': string;
  'enabled': boolean;
  'removable': boolean;
}
export interface ExtensionSetupActionInput {
  'extensionId': string;
  'setupId': string;
  'actionId': string;
  'values': ExtensionSetupValue[];
}
export interface ExtensionSetupValue {
  'id': string;
  'value': string;
}
export interface ExtensionsExtensionCatalogRequest {}
export interface ExtensionsExtensionCatalogResponse {
  'result': ExtensionCatalogView;
}
export interface ExtensionsRunExtensionActionRequest {
  'input': ExtensionActionInput;
}
export interface ExtensionsRunExtensionActionResponse {
  'result': ExtensionActionResult;
}
export interface FileEditorContributionView {
  'extensionId': string;
  'id': string;
  'label': string;
  'extensions': string[];
  'mode': string;
  'threadPresentation'?: string | null;
  'tag': string;
  'moduleUrl': string;
  'styleUrl'?: string | null;
}
export interface GoalView {
  'id': string;
  'threadId': string;
  'title': string;
  'intent': string;
  'status': string;
  'progress': string;
  'createdAt': number;
}
export interface HostAgentResource {
  'id': string;
  'available': boolean;
}
export interface HostDeviceAccess {
  'clientId': string;
  'name': string;
  'online': boolean;
  'workspaceIds': string[];
  'agentIds': string[];
}
export interface HostPowerStatus {
  'keepAwake': boolean;
  'active': boolean;
  'supported': boolean;
  'error'?: string | null;
}
export interface HostView {
  'id': string;
  'displayName': string;
  'kind': string;
  'connector': string;
  'status': string;
  'agentIds': string[];
}
export interface HostWorkspaceResource {
  'shareId': string;
  'root': string;
  'alias': string;
}
export interface HtmlPreview {
  'source': string;
  'html': string;
}
export interface IntegrationStatus {
  'id': string;
  'available': boolean;
  'authenticated': boolean;
  'detail': string;
}
export interface LegacyDataIssueView {
  'id': string;
  'title': string;
  'detail': string;
  'affectedIds': string[];
  'cleanupAction': string;
}
export interface LocalFileEntry {
  'name': string;
  'url': string;
  'isDirectory': boolean;
}
export interface MarkdownDocument {
  'path': string;
  'content': string;
}
export interface MessageActionResult {
  'threadId': string;
  'snapshot': AppSnapshot;
}
export interface MessageAttachmentInput {
  'name': string;
  'mediaType': string;
  'bytes': Uint8Array;
}
export interface MessageBlockContributionView {
  'uiType'?: string | null;
  'extensionId': string;
  'kind': string;
  'tag'?: string | null;
  'moduleUrl'?: string | null;
  'styleUrl'?: string | null;
  'hostRenderer'?: string | null;
  'capability'?: string | null;
}
export interface MessageCancelAttemptRequest {
  'attemptId': string;
}
export interface MessageCancelAttemptResponse {
  'result': AppSnapshot;
}
export interface MessageForkMessageRequest {
  'threadId': string;
  'messageId': string;
}
export interface MessageForkMessageResponse {
  'result': MessageActionResult;
}
export interface MessagePartView {
  'id': string;
  'kind': string;
  'text'?: string | null;
  'url'?: string | null;
  'name'?: string | null;
  'mediaType'?: string | null;
  'sizeBytes'?: bigint | null;
  'dataJson'?: string | null;
}
export interface MessageReadMessageAttachmentRequest {
  'attachmentId': string;
}
export interface MessageReadMessageAttachmentResponse {
  'result': Uint8Array;
}
export interface MessageRestartMessageRequest {
  'threadId': string;
  'messageId': string;
  'content': string;
}
export interface MessageRestartMessageResponse {
  'result': MessageActionResult;
}
export interface MessageSelectAgentRequest {
  'threadId': string;
  'agent': string;
}
export interface MessageSelectAgentResponse {
  'result': AppSnapshot;
}
export interface MessageSelectHostRequest {
  'threadId': string;
  'hostId': string;
}
export interface MessageSelectHostResponse {
  'result': AppSnapshot;
}
export interface MessageSendMessageRequest {
  'threadId': string;
  'content': string;
}
export interface MessageSendMessageResponse {
  'result': AppSnapshot;
}
export interface MessageSendMessageWithAttachmentsRequest {
  'threadId': string;
  'content': string;
  'attachments': MessageAttachmentInput[];
}
export interface MessageSendMessageWithAttachmentsResponse {
  'result': AppSnapshot;
}
export interface ModelContributionView {
  'extensionId': string;
  'id': string;
  'label': string;
  'provider': string;
  'remoteId': string;
  'agentIds': string[];
  'recommended': boolean;
  'description': string;
}
export interface ModelInput {
  'id': string;
  'label': string;
  'provider': string;
  'remoteId': string;
  'enabled': boolean;
  'agentIds': string[];
}
export interface ModelView {
  'id': string;
  'label': string;
  'provider': string;
  'remoteId': string;
  'enabled': boolean;
  'agentIds': string[];
  'extensionId'?: string | null;
  'recommended': boolean;
  'description': string;
}
export interface NodeView {
  'id': string;
  'goalId': string;
  'threadId': string;
  'kind': string;
  'title': string;
  'status': string;
  'agent'?: string | null;
  'dependencyIds': string[];
  'hostId': string;
  'workspaceBindingIds': string[];
  'createdAt': number;
}
export interface OllamaModelCatalog {
  'models': OnboardingModelOption[];
  'jobs': OllamaModelJobView[];
}
export interface OllamaModelJobView {
  'model': string;
  'status': string;
  'detail': string;
  'error'?: string | null;
}
export interface OnboardingAgentInput {
  'id': string;
  'label': string;
  'driver': string;
  'modelId'?: string | null;
}
export interface OnboardingInput {
  'threadId'?: string | null;
  'agents': OnboardingAgentInput[];
  'defaultAgentId': string;
}
export interface OnboardingModelOption {
  'id': string;
  'label': string;
  'provider': string;
  'remoteId': string;
  'available': boolean;
  'recommended': boolean;
  'detail': string;
  'agentId'?: string | null;
}
export interface OnboardingStatus {
  'authorizationUrl'?: string | null;
  'agents': AgentView[];
  'models': OnboardingModelOption[];
  'toolchains': ToolchainView[];
  'setups': ExtensionOnboardingView[];
  'defaultAgentId'?: string | null;
}
export interface PendingApprovalView {
  'requestId': string;
  'attemptId': string;
  'tool': string;
  'argumentsJson': string;
  'automaticAllowed': boolean;
  'reviewFallback': boolean;
  'expiresAtMs': bigint;
}
export interface PreviewDescribeRequest {
  'id': string;
}
export interface PreviewDescribeResponse {
  'result': PreviewInfo;
}
export interface PreviewFile {
  'name': string;
  'extension': string;
  'sizeBytes': bigint;
  'bytes': Uint8Array;
}
export interface PreviewInfo {
  'id': string;
  'url': string;
  'kind': string;
  'editor'?: FileEditorContributionView | null;
}
export interface PreviewReadFileRequest {
  'id': string;
}
export interface PreviewReadFileResponse {
  'result': PreviewFile;
}
export interface PreviewReadTextRequest {
  'id': string;
}
export interface PreviewReadTextResponse {
  'result': string;
}
export interface ProjectView {
  'id': string;
  'name': string;
  'sortOrder': number;
  'createdAt': number;
}
export interface RegisterEndpointInput {
  'displayName': string;
  'transport': string;
  'host'?: string | null;
  'port'?: number | null;
  'user'?: string | null;
  'authKind'?: string | null;
  'secret'?: string | null;
  'hostFingerprint'?: string | null;
  'agentIds'?: string[] | null;
  'workspaces'?: HostWorkspaceResource[] | null;
}
export interface RegisterEndpointResult {
  'endpointId': string;
  'snapshot': AppSnapshot;
}
export interface RemoteControlIceCandidate {
  'mid': string;
  'mLineIndex': number;
  'candidate': string;
}
export interface RemoteControlIceServer {
  'urls': string[];
  'username'?: string | null;
  'credential'?: string | null;
}
export interface RemoteControlSessionDescription {
  'type': string;
  'sdp': string;
}
export interface RemoteControlSignal {
  'sequence': bigint;
  'description'?: RemoteControlSessionDescription | null;
  'candidates': RemoteControlIceCandidate[];
}
export interface RemoteControlStartOptions {
  'authKey': string;
  'maxBitrateKbps'?: number | null;
  'targetFramerate'?: number | null;
  'screenId'?: bigint | null;
}
export interface RemoteControlUpdate {
  'sessionId': string;
  'state': string;
  'route': string;
  'error'?: string | null;
  'iceServers'?: RemoteControlIceServer[] | null;
  'signals': RemoteControlSignal[];
}
export interface RemoteEndpointView {
  'id': string;
  'displayName': string;
  'transport': string;
  'host'?: string | null;
  'remoteId'?: string | null;
  'port'?: number | null;
  'user'?: string | null;
  'authKind'?: string | null;
  'hostFingerprint'?: string | null;
  'spiceWebsocketUrl'?: string | null;
  'lastSeenAt'?: number | null;
  'agentIds': string[];
  'workspaces': HostWorkspaceResource[];
}
export interface RemotingClipboardRequest {
  'sessionId': bigint;
  'text': string;
}
export interface RemotingClipboardResponse {
  'result': boolean;
}
export interface RemotingSignalRequest {
  'sessionId': bigint;
  'signal': RemoteControlSignal;
}
export interface RemotingSignalResponse {
  'result': boolean;
}
export interface RemotingSnapshotRequest {
  'sessionId': bigint;
  'afterSequence': bigint;
}
export interface RemotingSnapshotResponse {
  'result': RemoteControlUpdate;
}
export interface RemotingStartRequest {
  'endpointId': string;
  'options': RemoteControlStartOptions;
}
export interface RemotingStartResponse {
  'result': bigint;
}
export interface RemotingStopRequest {
  'sessionId': bigint;
}
export interface RemotingStopResponse {
  'result': boolean;
}
export interface SetHostDeviceAccessInput {
  'clientId': string;
  'workspaceIds': string[];
  'agentIds': string[];
}
export interface SettingsCleanLegacyDataRequest {}
export interface SettingsCleanLegacyDataResponse {
  'result': AppSnapshot;
}
export interface SettingsImportSkillRequest {
  'path': string;
  'enabled': boolean;
}
export interface SettingsImportSkillResponse {
  'result': AppSnapshot;
}
export interface SettingsInstallBundledSkillRequest {
  'skillId': string;
}
export interface SettingsInstallBundledSkillResponse {
  'result': AppSnapshot;
}
export interface SettingsOpenSystemUrlRequest {
  'url': string;
}
export interface SettingsOpenSystemUrlResponse {
  'result': boolean;
}
export interface SettingsRemoveAgentRequest {
  'agentId': string;
}
export interface SettingsRemoveAgentResponse {
  'result': AppSnapshot;
}
export interface SettingsRemoveModelRequest {
  'modelId': string;
}
export interface SettingsRemoveModelResponse {
  'result': AppSnapshot;
}
export interface SettingsRemoveSkillRequest {
  'skillId': string;
}
export interface SettingsRemoveSkillResponse {
  'result': AppSnapshot;
}
export interface SettingsRemoveToolRequest {
  'toolId': string;
}
export interface SettingsRemoveToolResponse {
  'result': AppSnapshot;
}
export interface SettingsSetSkillEnabledRequest {
  'skillId': string;
  'enabled': boolean;
}
export interface SettingsSetSkillEnabledResponse {
  'result': AppSnapshot;
}
export interface SettingsUpsertAgentRequest {
  'input': AgentInput;
}
export interface SettingsUpsertAgentResponse {
  'result': AppSnapshot;
}
export interface SettingsUpsertModelRequest {
  'input': ModelInput;
}
export interface SettingsUpsertModelResponse {
  'result': AppSnapshot;
}
export interface SettingsUpsertToolRequest {
  'input': ToolInput;
}
export interface SettingsUpsertToolResponse {
  'result': AppSnapshot;
}
export interface SetupCleanOnboardingStateRequest {}
export interface SetupCleanOnboardingStateResponse {
  'result': OnboardingStatus;
}
export interface SetupCompleteOnboardingRequest {
  'input': OnboardingInput;
}
export interface SetupCompleteOnboardingResponse {
  'result': AppSnapshot;
}
export interface SetupInstallExtensionRequest {
  'path': string;
}
export interface SetupInstallExtensionResponse {
  'result': AppSnapshot;
}
export interface SetupInstallToolchainRequest {
  'toolchainId': string;
}
export interface SetupInstallToolchainResponse {
  'result': ToolchainView[];
}
export interface SetupOllamaModelJobsRequest {}
export interface SetupOllamaModelJobsResponse {
  'result': OllamaModelJobView[];
}
export interface SetupOllamaModelsRequest {}
export interface SetupOllamaModelsResponse {
  'result': OllamaModelCatalog;
}
export interface SetupOnboardingStatusRequest {}
export interface SetupOnboardingStatusResponse {
  'result': OnboardingStatus;
}
export interface SetupPullOllamaModelRequest {
  'model': string;
}
export interface SetupPullOllamaModelResponse {
  'result': OllamaModelJobView;
}
export interface SetupRemoveExtensionRequest {
  'extensionId': string;
}
export interface SetupRemoveExtensionResponse {
  'result': AppSnapshot;
}
export interface SetupRunExtensionSetupActionRequest {
  'input': ExtensionSetupActionInput;
}
export interface SetupRunExtensionSetupActionResponse {
  'result': OnboardingStatus;
}
export interface SetupSetExtensionEnabledRequest {
  'extensionId': string;
  'enabled': boolean;
}
export interface SetupSetExtensionEnabledResponse {
  'result': AppSnapshot;
}
export interface SetupToolchainStatusRequest {}
export interface SetupToolchainStatusResponse {
  'result': ToolchainView[];
}
export interface ShareWorkspaceLinkResult {
  'requiresReset': boolean;
  'endpointAddrJson': string;
  'endpointId': string;
  'shareId': string;
  'root': string;
  'alias': string;
  'pending': WorkspaceLinkPairingRequest[];
  'devices': HostDeviceAccess[];
  'workspaces': HostWorkspaceResource[];
  'agents': HostAgentResource[];
}
export interface SkillView {
  'id': string;
  'name': string;
  'description': string;
  'path': string;
  'enabled': boolean;
}
export interface SlashCommandContributionView {
  'extensionId': string;
  'id': string;
  'label': string;
  'description': string;
  'skills'?: string[] | null;
}
export interface TerminalCancelTerminalRequest {
  'runId': string;
}
export interface TerminalCancelTerminalResponse {
  'result': AppSnapshot;
}
export interface TerminalCloseSessionRequest {
  'id': string;
}
export interface TerminalCloseSessionResponse {
  'result': boolean;
}
export interface TerminalConfigureShellProfilesRequest {
  'configuration': string;
}
export interface TerminalConfigureShellProfilesResponse {}
export interface TerminalListSessionsRequest {}
export interface TerminalListSessionsResponse {
  'result': string;
}
export interface TerminalOpenSessionRequest {
  'owner': string;
  'profileId': string;
  'directory': string;
  'cols': number;
  'rows': number;
}
export interface TerminalOpenSessionResponse {
  'result': string;
}
export interface TerminalReadSessionRequest {
  'id': string;
  'cursor': bigint;
}
export interface TerminalReadSessionResponse {
  'result': string;
}
export interface TerminalResizeSessionRequest {
  'id': string;
  'cols': number;
  'rows': number;
}
export interface TerminalResizeSessionResponse {}
export interface TerminalRunView {
  'id': string;
  'threadId': string;
  'ownerId'?: string | null;
  'command': string;
  'status': string;
  'stdout': string;
  'stderr': string;
  'exitCode'?: number | null;
}
export interface TerminalShellProfilesRequest {}
export interface TerminalShellProfilesResponse {
  'result': string;
}
export interface TerminalStartTerminalRequest {
  'threadId': string;
  'command': string;
  'ownerId'?: string | null;
  'workspaceBindingId'?: string | null;
  'useThreadWorkspace'?: boolean | null;
}
export interface TerminalStartTerminalResponse {
  'result': AppSnapshot;
}
export interface TerminalWriteSessionRequest {
  'id': string;
  'data': Uint8Array;
}
export interface TerminalWriteSessionResponse {}
export interface TestSshEndpointResult {
  'reachable': boolean;
  'detail': string;
}
export interface TestWorkspaceLinkResult {
  'connected': boolean;
  'clientId': string;
  'detail': string;
  'root'?: string | null;
  'agentIds': string[];
  'workspaces': HostWorkspaceResource[];
  'capabilities': string[];
}
export interface ThreadMessageView {
  'id': string;
  'threadId': string;
  'role': string;
  'content': string;
  'parts': MessagePartView[];
  'status': string;
  'streamSequence': bigint;
  'createdAt': number;
  'attemptId'?: string | null;
}
export interface ThreadView {
  'id': string;
  'title': string;
  'agent': string;
  'hostId': string;
  'workspacePath': string;
  'modelId'?: string | null;
  'projectId'?: string | null;
  'workspaceBindingIds': string[];
}
export interface ToolInput {
  'id': string;
  'label': string;
  'transport': string;
  'target': string;
  'args': string[];
  'enabled': boolean;
  'required': boolean;
  'credentialEnv'?: string | null;
}
export interface ToolView {
  'id': string;
  'label': string;
  'transport': string;
  'target': string;
  'args': string[];
  'enabled': boolean;
  'required': boolean;
  'available': boolean;
  'detail': string;
  'credentialEnv'?: string | null;
  'extensionId'?: string | null;
  'toolchainId'?: string | null;
  'capabilities': string[];
}
export interface ToolchainView {
  'id': string;
  'label': string;
  'kind': string;
  'provider': string;
  'requestedVersion'?: string | null;
  'available': boolean;
  'installable': boolean;
  'managed': boolean;
  'detail': string;
  'executable'?: string | null;
  'version'?: string | null;
  'installHint'?: string | null;
  'requiredToolchainIds': string[];
  'installStatus': string;
  'installError'?: string | null;
}
export interface WorkflowAddGateRequest {
  'goalId': string;
  'title': string;
}
export interface WorkflowAddGateResponse {
  'result': AppSnapshot;
}
export interface WorkflowAddTaskRequest {
  'goalId': string;
  'title': string;
  'agent'?: string | null;
}
export interface WorkflowAddTaskResponse {
  'result': AppSnapshot;
}
export interface WorkflowAdvanceWorkflowRequest {
  'threadId': string;
}
export interface WorkflowAdvanceWorkflowResponse {
  'result': AppSnapshot;
}
export interface WorkflowCreateGoalRequest {
  'threadId': string;
  'title': string;
  'intent': string;
}
export interface WorkflowCreateGoalResponse {
  'result': AppSnapshot;
}
export interface WorkflowDelegateTaskRequest {
  'taskId': string;
}
export interface WorkflowDelegateTaskResponse {
  'result': AppSnapshot;
}
export interface WorkflowResetWorkflowsRequest {}
export interface WorkflowResetWorkflowsResponse {
  'result': AppSnapshot;
}
export interface WorkflowResolveGateRequest {
  'nodeId': string;
  'approved': boolean;
}
export interface WorkflowResolveGateResponse {
  'result': AppSnapshot;
}
export interface WorkspaceBindWorkspaceRequest {
  'input': BindWorkspaceInput;
}
export interface WorkspaceBindWorkspaceResponse {
  'result': AppSnapshot;
}
export interface WorkspaceBindingView {
  'id': string;
  'threadId': string;
  'hostId': string;
  'kind': string;
  'endpointId'?: string | null;
  'resourceId'?: string | null;
  'root': string;
  'alias': string;
  'sortOrder': number;
  'trust': string;
}
export interface WorkspaceBrowserSuggestionsRequest {
  'threadId'?: string | null;
  'query': string;
}
export interface WorkspaceBrowserSuggestionsResponse {
  'result': BrowserSuggestion[];
}
export interface WorkspaceConfigureHostSpiceRequest {
  'endpointId': string;
  'websocketUrl'?: string | null;
}
export interface WorkspaceConfigureHostSpiceResponse {
  'result': AppSnapshot;
}
export interface WorkspaceCreateProjectRequest {
  'name': string;
}
export interface WorkspaceCreateProjectResponse {
  'result': AppSnapshot;
}
export interface WorkspaceCreateThreadRequest {
  'input': CreateThreadInput;
}
export interface WorkspaceCreateThreadResponse {
  'result': AppSnapshot;
}
export interface WorkspaceDesktopPermissionsRequest {}
export interface WorkspaceDesktopPermissionsResponse {
  'result': DesktopPermissions;
}
export interface WorkspaceDiscoverSshHostRequest {}
export interface WorkspaceDiscoverSshHostResponse {
  'result': DiscoverSshHostResult;
}
export interface WorkspaceFile {
  'path': string;
  'name': string;
  'extension': string;
  'sizeBytes': bigint;
  'bytes': Uint8Array;
}
export interface WorkspaceHostPowerStatusRequest {}
export interface WorkspaceHostPowerStatusResponse {
  'result': HostPowerStatus;
}
export interface WorkspaceLinkPairingRequest {
  'clientId': string;
  'name': string;
  'code': string;
}
export interface WorkspaceMoveThreadToProjectRequest {
  'threadId': string;
  'projectId': string;
}
export interface WorkspaceMoveThreadToProjectResponse {
  'result': AppSnapshot;
}
export interface WorkspaceRegenerateHostLinkRequest {}
export interface WorkspaceRegenerateHostLinkResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceRegisterEndpointRequest {
  'input': RegisterEndpointInput;
}
export interface WorkspaceRegisterEndpointResponse {
  'result': RegisterEndpointResult;
}
export interface WorkspaceRemoveRemoteHostRequest {
  'endpointId': string;
}
export interface WorkspaceRemoveRemoteHostResponse {
  'result': AppSnapshot;
}
export interface WorkspaceRenameProjectRequest {
  'projectId': string;
  'name': string;
}
export interface WorkspaceRenameProjectResponse {
  'result': AppSnapshot;
}
export interface WorkspaceRepairLocalHostAccessRequest {}
export interface WorkspaceRepairLocalHostAccessResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceRequestDesktopPermissionRequest {
  'permission': string;
}
export interface WorkspaceRequestDesktopPermissionResponse {
  'result': DesktopPermissions;
}
export interface WorkspaceResetLinkHostsRequest {}
export interface WorkspaceResetLinkHostsResponse {
  'result': AppSnapshot;
}
export interface WorkspaceResetLocalHostLinkIdentityRequest {}
export interface WorkspaceResetLocalHostLinkIdentityResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceRevokeWorkspaceLinkRequest {
  'shareId': string;
  'clientId': string;
}
export interface WorkspaceRevokeWorkspaceLinkResponse {
  'result': boolean;
}
export interface WorkspaceSetHostKeepAwakeRequest {
  'enabled': boolean;
}
export interface WorkspaceSetHostKeepAwakeResponse {
  'result': HostPowerStatus;
}
export interface WorkspaceSetThreadWorkspaceBindingsRequest {
  'threadId': string;
  'bindingIds': string[];
}
export interface WorkspaceSetThreadWorkspaceBindingsResponse {
  'result': AppSnapshot;
}
export interface WorkspaceSetThreadWorkspaceRequest {
  'threadId': string;
  'workspacePath': string;
}
export interface WorkspaceSetThreadWorkspaceResponse {
  'result': AppSnapshot;
}
export interface WorkspaceSetWorkspaceLinkAccessRequest {
  'input': SetHostDeviceAccessInput;
}
export interface WorkspaceSetWorkspaceLinkAccessResponse {
  'result': boolean;
}
export interface WorkspaceShareCurrentWorkspaceLinkRequest {
  'threadId': string;
}
export interface WorkspaceShareCurrentWorkspaceLinkResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceShareHostLinkRequest {}
export interface WorkspaceShareHostLinkResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceShareWorkspaceLinkRequest {
  'root': string;
  'alias': string;
}
export interface WorkspaceShareWorkspaceLinkResponse {
  'result': ShareWorkspaceLinkResult;
}
export interface WorkspaceSnapshotRequest {}
export interface WorkspaceSnapshotResponse {
  'result': AppSnapshot;
}
export interface WorkspaceSubmitWorkspaceLinkPairingRequest {
  'endpointAddrJson': string;
  'shareId': string;
  'code': string;
}
export interface WorkspaceSubmitWorkspaceLinkPairingResponse {
  'result': string;
}
export interface WorkspaceTestSshEndpointRequest {
  'input': RegisterEndpointInput;
  'root': string;
}
export interface WorkspaceTestSshEndpointResponse {
  'result': TestSshEndpointResult;
}
export interface WorkspaceTestWorkspaceLinkRequest {
  'endpointAddrJson': string;
  'shareId': string;
}
export interface WorkspaceTestWorkspaceLinkResponse {
  'result': TestWorkspaceLinkResult;
}
export interface WorkspaceUnbindRemoteHostRequest {
  'threadId': string;
  'endpointId': string;
}
export interface WorkspaceUnbindRemoteHostResponse {
  'result': AppSnapshot;
}
export interface WorkspaceUnbindWorkspaceRequest {
  'bindingId': string;
}
export interface WorkspaceUnbindWorkspaceResponse {
  'result': AppSnapshot;
}
import type { MojomTransport } from 'tuffite';
export interface OvuleApi {
  readonly 'agent': typeof agent;
  readonly 'browser': typeof browser;
  readonly 'content': typeof content;
  readonly 'extensions': typeof extensions;
  readonly 'message': typeof message;
  readonly 'preview': typeof preview;
  readonly 'remoting': typeof remoting;
  readonly 'settings': typeof settings;
  readonly 'setup': typeof setup;
  readonly 'terminal': typeof terminal;
  readonly 'workflow': typeof workflow;
  readonly 'workspace': typeof workspace;
}
export declare function createOvuleApi(transport?: MojomTransport): OvuleApi;
export declare const agent: {
  readonly 'respondApproval': (arg0: string, arg1: boolean) => Promise<boolean>;
  readonly 'executionCalls': (arg0: string) => Promise<ExecutionCallView[]>;
  readonly 'respondApprovalWithScope': (arg0: string, arg1: boolean, arg2: boolean) => Promise<boolean>;
  readonly 'pendingApprovals': (arg0: string) => Promise<PendingApprovalView[]>;
  readonly 'markApprovalPresented': (arg0: string) => Promise<boolean>;
  readonly 'approvalMode': () => Promise<string>;
  readonly 'setApprovalMode': (arg0: string) => Promise<boolean>;
};
export declare const browser: {
  readonly 'respond': (arg0: string, arg1: string) => Promise<boolean>;
  readonly 'listDownloads': () => Promise<DownloadView[]>;
  readonly 'publishDownload': (arg0: string, arg1: string) => Promise<DownloadView>;
  readonly 'revealDownload': (arg0: string) => Promise<boolean>;
  readonly 'removeDownload': (arg0: string) => Promise<boolean>;
  readonly 'downloadDirectory': () => Promise<string>;
  readonly 'setDownloadDirectory': (arg0: string) => Promise<string>;
  readonly 'readLocalText': (arg0: string) => Promise<string>;
  readonly 'listLocalDirectory': (arg0: string) => Promise<LocalFileEntry[]>;
  readonly 'readLocalFile': (arg0: string) => Promise<WorkspaceFile>;
  readonly 'createFilePreview': (arg0: string) => Promise<PreviewInfo>;
  readonly 'revokePreview': (arg0: string) => Promise<boolean>;
  readonly 'createHtmlPreview': (arg0: string, arg1: string) => Promise<PreviewInfo>;
  readonly 'revealLocalFile': (arg0: string) => Promise<boolean>;
};
export declare const content: {
  readonly 'readHtmlPreview': (arg0: string, arg1: string) => Promise<HtmlPreview>;
  readonly 'readMarkdown': (arg0: string, arg1: string) => Promise<MarkdownDocument>;
  readonly 'saveMarkdown': (arg0: string, arg1: string, arg2: string) => Promise<MarkdownDocument>;
  readonly 'readWorkspaceFile': (arg0: string, arg1: string) => Promise<WorkspaceFile>;
  readonly 'saveWorkspaceFile': (arg0: string, arg1: string, arg2: Uint8Array) => Promise<WorkspaceFile>;
};
export declare const extensions: {
  readonly 'extensionCatalog': () => Promise<ExtensionCatalogView>;
  readonly 'runExtensionAction': (arg0: ExtensionActionInput) => Promise<ExtensionActionResult>;
};
export declare const message: {
  readonly 'selectAgent': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'selectHost': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'sendMessage': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'sendMessageWithAttachments': (arg0: string, arg1: string, arg2: MessageAttachmentInput[]) => Promise<AppSnapshot>;
  readonly 'readMessageAttachment': (arg0: string) => Promise<Uint8Array>;
  readonly 'cancelAttempt': (arg0: string) => Promise<AppSnapshot>;
  readonly 'forkMessage': (arg0: string, arg1: string) => Promise<MessageActionResult>;
  readonly 'restartMessage': (arg0: string, arg1: string, arg2: string) => Promise<MessageActionResult>;
};
export declare const preview: {
  readonly 'describe': (arg0: string) => Promise<PreviewInfo>;
  readonly 'readText': (arg0: string) => Promise<string>;
  readonly 'readFile': (arg0: string) => Promise<PreviewFile>;
};
export declare const remoting: {
  readonly 'start': (arg0: string, arg1: RemoteControlStartOptions) => Promise<bigint>;
  readonly 'signal': (arg0: bigint, arg1: RemoteControlSignal) => Promise<boolean>;
  readonly 'snapshot': (arg0: bigint, arg1: bigint) => Promise<RemoteControlUpdate>;
  readonly 'clipboard': (arg0: bigint, arg1: string) => Promise<boolean>;
  readonly 'stop': (arg0: bigint) => Promise<boolean>;
};
export declare const settings: {
  readonly 'importSkill': (arg0: string, arg1: boolean) => Promise<AppSnapshot>;
  readonly 'installBundledSkill': (arg0: string) => Promise<AppSnapshot>;
  readonly 'setSkillEnabled': (arg0: string, arg1: boolean) => Promise<AppSnapshot>;
  readonly 'removeSkill': (arg0: string) => Promise<AppSnapshot>;
  readonly 'upsertTool': (arg0: ToolInput) => Promise<AppSnapshot>;
  readonly 'removeTool': (arg0: string) => Promise<AppSnapshot>;
  readonly 'cleanLegacyData': () => Promise<AppSnapshot>;
  readonly 'upsertModel': (arg0: ModelInput) => Promise<AppSnapshot>;
  readonly 'removeModel': (arg0: string) => Promise<AppSnapshot>;
  readonly 'upsertAgent': (arg0: AgentInput) => Promise<AppSnapshot>;
  readonly 'removeAgent': (arg0: string) => Promise<AppSnapshot>;
  readonly 'openSystemUrl': (arg0: string) => Promise<boolean>;
};
export declare const setup: {
  readonly 'onboardingStatus': () => Promise<OnboardingStatus>;
  readonly 'toolchainStatus': () => Promise<ToolchainView[]>;
  readonly 'installToolchain': (arg0: string) => Promise<ToolchainView[]>;
  readonly 'ollamaModelJobs': () => Promise<OllamaModelJobView[]>;
  readonly 'ollamaModels': () => Promise<OllamaModelCatalog>;
  readonly 'pullOllamaModel': (arg0: string) => Promise<OllamaModelJobView>;
  readonly 'completeOnboarding': (arg0: OnboardingInput) => Promise<AppSnapshot>;
  readonly 'runExtensionSetupAction': (arg0: ExtensionSetupActionInput) => Promise<OnboardingStatus>;
  readonly 'installExtension': (arg0: string) => Promise<AppSnapshot>;
  readonly 'setExtensionEnabled': (arg0: string, arg1: boolean) => Promise<AppSnapshot>;
  readonly 'removeExtension': (arg0: string) => Promise<AppSnapshot>;
  readonly 'cleanOnboardingState': () => Promise<OnboardingStatus>;
};
export declare const terminal: {
  readonly 'shellProfiles': () => Promise<string>;
  readonly 'configureShellProfiles': (arg0: string) => Promise<void>;
  readonly 'openSession': (arg0: string, arg1: string, arg2: string, arg3: number, arg4: number) => Promise<string>;
  readonly 'readSession': (arg0: string, arg1: bigint) => Promise<string>;
  readonly 'writeSession': (arg0: string, arg1: Uint8Array) => Promise<void>;
  readonly 'resizeSession': (arg0: string, arg1: number, arg2: number) => Promise<void>;
  readonly 'closeSession': (arg0: string) => Promise<boolean>;
  readonly 'listSessions': () => Promise<string>;
  readonly 'startTerminal': (arg0: string, arg1: string, arg2?: string | null, arg3?: string | null, arg4?: boolean | null) => Promise<AppSnapshot>;
  readonly 'cancelTerminal': (arg0: string) => Promise<AppSnapshot>;
};
export declare const workflow: {
  readonly 'advanceWorkflow': (arg0: string) => Promise<AppSnapshot>;
  readonly 'createGoal': (arg0: string, arg1: string, arg2: string) => Promise<AppSnapshot>;
  readonly 'addTask': (arg0: string, arg1: string, arg2?: string | null) => Promise<AppSnapshot>;
  readonly 'addGate': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'delegateTask': (arg0: string) => Promise<AppSnapshot>;
  readonly 'resolveGate': (arg0: string, arg1: boolean) => Promise<AppSnapshot>;
  readonly 'resetWorkflows': () => Promise<AppSnapshot>;
};
export declare const workspace: {
  readonly 'snapshot': () => Promise<AppSnapshot>;
  readonly 'createThread': (arg0: CreateThreadInput) => Promise<AppSnapshot>;
  readonly 'setThreadWorkspace': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'browserSuggestions': (arg0: string | null, arg1: string) => Promise<BrowserSuggestion[]>;
  readonly 'createProject': (arg0: string) => Promise<AppSnapshot>;
  readonly 'renameProject': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'moveThreadToProject': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'bindWorkspace': (arg0: BindWorkspaceInput) => Promise<AppSnapshot>;
  readonly 'unbindWorkspace': (arg0: string) => Promise<AppSnapshot>;
  readonly 'unbindRemoteHost': (arg0: string, arg1: string) => Promise<AppSnapshot>;
  readonly 'removeRemoteHost': (arg0: string) => Promise<AppSnapshot>;
  readonly 'configureHostSpice': (arg0: string, arg1?: string | null) => Promise<AppSnapshot>;
  readonly 'resetLinkHosts': () => Promise<AppSnapshot>;
  readonly 'setThreadWorkspaceBindings': (arg0: string, arg1: string[]) => Promise<AppSnapshot>;
  readonly 'registerEndpoint': (arg0: RegisterEndpointInput) => Promise<RegisterEndpointResult>;
  readonly 'testSshEndpoint': (arg0: RegisterEndpointInput, arg1: string) => Promise<TestSshEndpointResult>;
  readonly 'discoverSshHost': () => Promise<DiscoverSshHostResult>;
  readonly 'shareWorkspaceLink': (arg0: string, arg1: string) => Promise<ShareWorkspaceLinkResult>;
  readonly 'shareHostLink': () => Promise<ShareWorkspaceLinkResult>;
  readonly 'hostPowerStatus': () => Promise<HostPowerStatus>;
  readonly 'setHostKeepAwake': (arg0: boolean) => Promise<HostPowerStatus>;
  readonly 'regenerateHostLink': () => Promise<ShareWorkspaceLinkResult>;
  readonly 'repairLocalHostAccess': () => Promise<ShareWorkspaceLinkResult>;
  readonly 'resetLocalHostLinkIdentity': () => Promise<ShareWorkspaceLinkResult>;
  readonly 'shareCurrentWorkspaceLink': (arg0: string) => Promise<ShareWorkspaceLinkResult>;
  readonly 'setWorkspaceLinkAccess': (arg0: SetHostDeviceAccessInput) => Promise<boolean>;
  readonly 'submitWorkspaceLinkPairing': (arg0: string, arg1: string, arg2: string) => Promise<string>;
  readonly 'revokeWorkspaceLink': (arg0: string, arg1: string) => Promise<boolean>;
  readonly 'testWorkspaceLink': (arg0: string, arg1: string) => Promise<TestWorkspaceLinkResult>;
  readonly 'desktopPermissions': () => Promise<DesktopPermissions>;
  readonly 'requestDesktopPermission': (arg0: string) => Promise<DesktopPermissions>;
};
