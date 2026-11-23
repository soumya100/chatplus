/**
 * System-level access is granted only by deployment configuration.
 * Never accept a role supplied by a browser, profile form, or Redis user record.
 */
export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const configured = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  return configured.includes(email.trim().toLowerCase())
}
