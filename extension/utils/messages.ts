import type { HostAckView, ProtocolSkew, SavedEntry, SavedResults } from '../../native-host/protocol.mts';
import type { DomMeta, PostRecord } from './extractor/types.ts';
import type { WebMetaResult } from './extractor/web-meta.ts';
import type { SaveFailureKind } from './native-error.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import type { SaveQueueStats } from './save-queue.ts';

interface SavePostMessage {
  retryOf?: string;
  type: 'savePost';
  mediaKeys?: string[];
  postUrl: string;
  platform: string;
  saveId: string;
  capturedVia?: string | null;
  domMeta?: DomMeta | null;
}

interface CheckSavedMessage {
  type: 'checkSaved';
  urls: string[];
}

type LogEntry = SaveLogEntry;
interface LogCaptureMessage {
  type: 'logCapture';
  entry: LogEntry;
}
interface DumpLogsMessage {
  type: 'dumpLogs';
}
interface QueueStatsMessage {
  type: 'queueStats';
}
interface ResendQueueMessage {
  type: 'resendQueue';
}
interface PageMetaExtractedMessage {
  type: 'pageMetaExtracted';
  result: WebMetaResult;
}

interface RetryWebSaveMessage {
  type: 'retryWebSave';
  token: string;
}
interface WebSaveNoticeMessage {
  type: 'webSaveNotice';
  token: string;
  url: string;
  result?: SaveResponse;
}
type ContentToBackgroundMessage = SavePostMessage | CheckSavedMessage | LogCaptureMessage | DumpLogsMessage | QueueStatsMessage | ResendQueueMessage | PageMetaExtractedMessage | RetryWebSaveMessage;

interface SavedUpdateMessage {
  type: 'savedUpdate';
  url: string;
  media: Array<string | null>;
  total?: number | null;
  post?: boolean;
  individualMedia?: string[];
}
interface SaveProgressMessage {
  type: 'saveProgress';
  saveId: string;
  reached: SaveStage[];
}
type BackgroundToContentMessage = SavedUpdateMessage | SaveProgressMessage | WebSaveNoticeMessage;

interface ErrorResponse {
  savedNothing?: boolean;
  ok: false;
  error?: string;
  errorKind?: SaveFailureKind;
  metaReason?: string | null;
  queued?: boolean;
}

type BridgeAck = HostAckView;
type SaveResponse =
  | (BridgeAck & {
      ok: true;
      metaOk: boolean;
      metaReason: string | null;
      hostSkew?: ProtocolSkew | null;
      mediaMissing?: number;
      imageCount?: number | null;
      post?: boolean;
      individualMedia?: string[];
      domFilled?: string[];
      acquisitionIssues?: PostRecord['acquisitionIssues'];
      savedContent?: { text: boolean; profile: boolean; media: number };
    })
  | ErrorResponse;

type CheckSavedResponse = { ok: true; results: SavedResults } | { ok: false; error?: string; results: SavedResults };
interface LogCaptureResponse {
  ok: true;
}
interface DumpLogsResponse {
  ok: true;
  entries: unknown[];
}
interface QueueStatsResponse {
  ok: true;
  stats: SaveQueueStats;
}
interface ResendQueueResponse {
  ok: true;
  stats: SaveQueueStats;
}

export type {
  RetryWebSaveMessage,
  WebSaveNoticeMessage,
  BackgroundToContentMessage,
  BridgeAck,
  CheckSavedMessage,
  CheckSavedResponse,
  ContentToBackgroundMessage,
  DumpLogsMessage,
  DumpLogsResponse,
  LogCaptureMessage,
  LogCaptureResponse,
  LogEntry,
  PageMetaExtractedMessage,
  ProtocolSkew,
  QueueStatsMessage,
  QueueStatsResponse,
  ResendQueueMessage,
  ResendQueueResponse,
  SavedEntry,
  SavedResults,
  SavedUpdateMessage,
  SavePostMessage,
  SaveProgressMessage,
  SaveResponse,
};
