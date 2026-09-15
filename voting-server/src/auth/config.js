/**
 * Authentication Configuration Module
 *
 * Loads environment settings for JWT and the single global administrator.
 * In development or testing without explicit .env variables, defaults are provided
 * for graceful execution, but in production, JWT_SECRET should be explicitly configured.
 */

let activeConfig = {
  jwtSecret: process.env.JWT_SECRET || 'votesphere_jwt_evaluation_secret_fallback',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@votesphere.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'adminPassword123!',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h'
};

export function getAuthConfig() {
  return { ...activeConfig };
}

/**
 * Overrides authentication settings at runtime (useful for testing expired/tampered tokens).
 * @param {Object} overrides
 */
export function configureAuth(overrides = {}) {
  activeConfig = {
    ...activeConfig,
    ...overrides
  };
  return getAuthConfig();
}

/**
 * Resets configuration to process.env defaults.
 */
export function resetAuthConfig() {
  activeConfig = {
    jwtSecret: process.env.JWT_SECRET || 'votesphere_jwt_evaluation_secret_fallback',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@votesphere.local',
    adminPassword: process.env.ADMIN_PASSWORD || 'adminPassword123!',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h'
  };
  return getAuthConfig();
}

export default getAuthConfig;
