export async function getApps(db) {
  // Public catalogue: retired apps (is_active = 0) are hidden. The admin view
  // lists everything via /api/admin/apps.
  const { results } = await db.prepare("SELECT * FROM apps WHERE is_active = 1").all();
  return results;
}

export async function getAppById(db, id) {
  const result = await db.prepare("SELECT * FROM apps WHERE id = ?").bind(id).first();
  return result;
}

// True only for an app that exists and is not retired.
export async function isActiveApp(db, id) {
  const row = await db.prepare("SELECT 1 AS found FROM apps WHERE id = ? AND is_active = 1").bind(id).first();
  return Boolean(row);
}

export async function checkHealth(db) {
  try {
    const result = await db.prepare("SELECT 1 as alive").first();
    return result && result.alive === 1;
  } catch (err) {
    return false;
  }
}
