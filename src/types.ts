export type PromptMode = "basic" | "keyword" | "rag";
export type PromptOutputMode = "chat" | "append" | "replace_selection";
export type OutputAction = "insert_at_cursor" | "append_to_note" | "replace_selection" | "copy_to_clipboard" | "cancel";
export type PromptWorkflowOutputTarget = "chat" | "current_note" | "new_note" | "clipboard";

export interface AiPluginSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  vaultSearchMaxResults: number;
  vaultSearchMaxCharsPerResult: number;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingProvider: "api" | "local";
  localEmbeddingModel: string;
  localModelPath: string;
  vectorSearchMaxResults: number;
  chunkMaxChars: number;
  chunkOverlapChars: number;
  excludedFolders: string;
  includedTextExtensions: string;
  maxTextFileSizeKb: number;
  chatHistoryMaxMessages: number;
  linkCurrentNote: boolean;
  indexLogMaxEntries: number;
  enablePromptLibrary: boolean;
  promptLibraryPath: string;
  enablePromptFolder: boolean;
  promptFolderPath: string;
  enableOutputPreview: boolean;
  requestTimeoutSeconds: number;
  dailyNoteFolder: string;
  dailyNoteDateFormat: string;
  recentDailyNotesDays: number;
  indexStorageFolder: string;
  enableExternalIndexStorage: boolean;
  enableHybridSearch: boolean;
  hybridSemanticWeight: number;
  hybridKeywordWeight: number;
  hybridRecencyWeight: number;
  autoUpdateIndexOnStartup: boolean;
  enablePromptCommandRegistration: boolean;
  promptRunHistoryMaxEntries: number;
  workflowOutputFolder: string;
  batchRunMaxFiles: number;
}

export interface VaultSearchResult {
  path: string;
  score: number;
  excerpt: string;
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface SourceReference extends VaultSearchResult {}

export interface RagContext {
  contextText: string;
  sources: SourceReference[];
  mode: "semantic" | "keyword" | "none";
}

export interface VectorChunk {
  id: string;
  path: string;
  basename: string;
  mtime: number;
  chunkIndex: number;
  text: string;
  embedding: number[];
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface VectorChunkInput {
  id: string;
  path: string;
  basename: string;
  mtime: number;
  chunkIndex: number;
  text: string;
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface VaultVectorIndex {
  version: number;
  builtAt: string;
  updatedAt: string;
  embeddingModel: string;
  chunkMaxChars: number;
  chunkOverlapChars: number;
  excludedFolders: string;
  chunks: VectorChunk[];
}

export interface VectorIndexMeta {
  version: number;
  storageVersion: number;
  builtAt: string;
  updatedAt: string;
  embeddingModel: string;
  chunkMaxChars: number;
  chunkOverlapChars: number;
  excludedFolders: string;
  chunkCount: number;
  fileCount: number;
}

export interface HybridSearchResult extends VaultSearchResult {
  semanticScore: number;
  keywordScore: number;
  recencyScore: number;
}

export interface ChatMessage {
  role: "你" | "AI";
  content: string;
  createdAt: string;
}

export interface ChatMemoryEntry {
  seq: number;
  role: "你" | "AI";
  text: string;
  embedding: number[];
  modelId: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  memory?: ChatMemoryEntry[];
}

export interface IndexLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface PromptTemplateMetadata {
  category?: string;
  favorite?: boolean;
  mode?: PromptMode;
  output?: PromptOutputMode;
  description?: string;
  temperature?: number;
  maxSources?: number;
}

export interface PromptTemplate {
  name: string;
  content: string;
  sourcePath: string;
  metadata: PromptTemplateMetadata;
}

export interface PromptRenderContext {
  selection: string;
  note: string;
  question: string;
  vaultContext: string;
  sources: string;
  sourceCount: string;
  ragMode: string;
  filePath: string;
  fileName: string;
  date: string;
  time: string;
  chatHistory: string;
  lastAnswer: string;
}

export interface AiProgressStep {
  label: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface AiProgressState {
  active: boolean;
  title: string;
  startedAt: number;
  endedAt?: number;
  currentStep: string;
  error?: string;
  cancelled?: boolean;
  steps: AiProgressStep[];
}

export interface FriendlyAiError {
  title: string;
  message: string;
  detail?: string;
  statusCode?: number;
  isCancelled?: boolean;
}

export interface OutputPreviewPayload {
  title: string;
  content: string;
  sourcesMarkdown?: string;
  defaultAction: OutputAction;
}

export interface DailyNoteEntry {
  path: string;
  date: string;
  content: string;
}

export interface DailyNoteContext {
  todayPath: string;
  todayContent: string;
  recentNotes: DailyNoteEntry[];
  combinedRecentContent: string;
}

export interface PromptCommandBinding {
  templateName: string;
  commandId: string;
  commandName: string;
}

export interface PromptRunHistoryEntry {
  id: string;
  templateName: string;
  sourcePath?: string;
  outputTarget: PromptWorkflowOutputTarget;
  inputFilePath?: string;
  outputFilePath?: string;
  status: "success" | "failed" | "cancelled";
  error?: string;
  createdAt: string;
  durationMs: number;
  sourceCount?: number;
}

export interface BatchPromptRunOptions {
  templateName: string;
  filePaths: string[];
  outputTarget: PromptWorkflowOutputTarget;
  outputFolder?: string;
}

export interface BatchPromptRunResult {
  total: number;
  success: number;
  failed: number;
  outputFiles: string[];
}

export interface PluginData {
  settings?: Partial<AiPluginSettings>;
  vectorIndex?: VaultVectorIndex | null;
  chatHistory?: ChatMessage[];
  chatConversations?: ChatConversation[];
  activeChatId?: string;
  indexLogs?: IndexLogEntry[];
  lastIndexError?: string;
  promptRunHistory?: PromptRunHistoryEntry[];
}