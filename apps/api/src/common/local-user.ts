/**
 * The single, auto-provisioned local user. With auth removed, every request is
 * scoped to this id (see MIGRATION_PLAN.md "The local user"). The row is
 * upserted on bootstrap so foreign keys resolve.
 */
export const LOCAL_USER_ID = 'local-user';
export const LOCAL_USER_EMAIL = 'local@reader.app';
