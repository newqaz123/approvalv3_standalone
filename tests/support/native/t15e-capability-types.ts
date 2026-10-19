/**
 * T15E capability TYPES (Task82) — neutral, type-only module.
 *
 * Shared structural types for owned-runtime capabilities so the runtime
 * producer (postgres-instance) and the transport never need runtime imports
 * of each other's modules (the transport imports only the producer's
 * read-only identity VALIDATOR; the producer imports nothing from the
 * transport at runtime). Authority lives in the producer's private
 * minted-capability registry — there is no brand, token, or registration
 * surface here.
 */

export interface T15EOwnedClusterIdentity {
  runId: string
  dataDirectory: string
  databasePort: number
  database: string
  postmasterPid: number | null
}

export interface T15EOwnedRuntimeCapability {
  readonly kind: 'T15E_OWNED_RUNTIME_CAPABILITY'
  readonly cluster: Readonly<T15EOwnedClusterIdentity>
  /** Run-generated SCRAM password; carried frozen, never logged or exported. */
  readonly databasePassword: string
}
