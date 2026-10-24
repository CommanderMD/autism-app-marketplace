export async function getApps(db) {
  const { results } = await db.prepare("SELECT * FROM apps WHERE is_active = 1").all();
  return results;
}

export async function getAppById(db, id) {
  const result = await db.prepare("SELECT * FROM apps WHERE id = ? AND is_active = 1").bind(id).first();
  return result;
}

export async function checkHealth(db) {
  try {
    const result = await db.prepare("SELECT 1 as alive").first();
    return result && result.alive === 1;
  } catch (e) {
    return false;
  }
}
