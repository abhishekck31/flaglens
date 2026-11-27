export type FlagValue = string | number | boolean | null;

export interface FlagState {
  enabled: boolean;
  value: FlagValue;
  variant?: string | null;
  reason?: string;
  isPinned?: boolean;
  isFallback?: boolean;
}

export type FlagMap = Record<string, FlagState>;

export interface FlagOverride {
  enabled?: boolean;
  value?: FlagValue;
  variant?: string | null;
}

export type OverrideMap = Record<string, FlagOverride>;

export interface ChaosConfig {
  /** Artificial delay in milliseconds (0 to 3000) before resolving SDK fetches */
  latencyMs: number;
  /** When true, simulates a 503 Service Unavailable response and triggers fallback */
  offline503: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TrackEventInput {
  event: string;
  featureName?: string | null;
  identifier?: string | null;
  timestamp?: number;
  value?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface QueuedEvent {
  event: string;
  feature_name?: string | null;
  identifier?: string | null;
  timestamp: number;
  value?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface FlushResult {
  accepted: number;
  rejected: number;
  batches: number;
}

export interface EnvironmentParityItem {
  featureName: string;
  featureType: string;
  development: FlagState | null;
  production: FlagState | null;
  hasDrift: boolean;
  driftReason: string | null;
}

export interface DevFlagsmithConfig {
  environmentID: string;
  productionEnvironmentID?: string;
  api?: string;
  eventsUrl?: string;
  identity?: string;
  defaultFlagHandler?: (featureName: string) => FlagState;
  fetchImpl?: typeof fetch;
  storage?: StorageLike;
  storageKeyPrefix?: string;
}

export interface DevFlagsmithSnapshot {
  flags: FlagMap;
  liveFlags: FlagMap;
  overrides: OverrideMap;
  chaos: ChaosConfig;
  loading: boolean;
  isFallback: boolean;
  lastError: string | null;
  lastLatencyMs: number | null;
  queuedEventCount: number;
  identity: string | null;
}

export interface DevFlagsmithClient {
  init(): Promise<FlagMap>;
  refresh(): Promise<FlagMap>;
  identify(identity: string): Promise<FlagMap>;
  getFlags(): FlagMap;
  hasFeature(featureName: string): boolean;
  isFeatureEnabled(featureName: string): boolean;
  getValue(featureName: string, defaultValue?: FlagValue): FlagValue;
  getFlag(featureName: string): FlagState;
  setOverride(featureName: string, override: FlagOverride): void;
  clearOverride(featureName: string): void;
  resetOverrides(): void;
  getOverrides(): OverrideMap;
  setChaos(chaos: Partial<ChaosConfig>): void;
  getChaos(): ChaosConfig;
  trackEvent(input: TrackEventInput): void;
  flushEvents(): Promise<FlushResult>;
  getEnvironmentParity(devEnvKey?: string, prodEnvKey?: string): Promise<EnvironmentParityItem[]>;
  getSnapshot(): DevFlagsmithSnapshot;
  subscribe(listener: (snapshot: DevFlagsmithSnapshot) => void): () => void;
}

export interface VariantSimulationSpec {
  key: string;
  value: string;
  weight: number;
  conversionRate: number;
}

export interface SimulationConfig {
  environmentKey: string;
  eventsUrl?: string;
  apiUrl?: string;
  featureName?: string;
  metricEventName?: string;
  experimentId?: number;
  masterApiKey?: string;
  refreshUrl?: string;
  visitorCount?: number;
  variants?: VariantSimulationSpec[];
  fetchImpl?: typeof fetch;
  onProgress?: (completed: number, total: number) => void;
}

export interface VariantSimulationStats {
  key: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
}

export interface SimulationResult {
  totalVisitors: number;
  exposuresSent: number;
  conversionsSent: number;
  variants: VariantSimulationStats[];
  refreshStatus: "refreshed" | "cooldown" | "skipped" | "error";
  refreshMessage: string;
}

export interface PinPresetOption {
  label: string;
  key: string | null;
  value: FlagValue;
  enabled: boolean;
}

export interface FlagsmithDevBarProps {
  client: DevFlagsmithClient;
  devEnvironmentKey: string;
  prodEnvironmentKey?: string;
  apiUrl?: string;
  eventsUrl?: string;
  experimentId?: number;
  masterApiKey?: string;
  refreshUrl?: string;
  pinPresets?: Record<string, PinPresetOption[]>;
  defaultOpen?: boolean;
}
