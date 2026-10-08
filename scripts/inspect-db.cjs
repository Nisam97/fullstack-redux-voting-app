/* One-off inspection script (CommonJS, uses voting-server's mongoose). */
const path = require('path');
const M = require(path.join(__dirname, '..', 'voting-server', 'node_modules', 'mongoose'));

function countColl(coll) {
  return M.connection.db.command({ count: coll }).then(r => r.n).catch(e => ({ err: e.message }));
}

function sample(coll, fields, n = 10) {
  return M.connection.collection(coll).find(
    fields ? {} : {},
    { projection: Object.fromEntries(fields.map(f => [f, 1])), limit: n, sort: { _id: -1 } }
  ).toArray();
}

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/votesphere_dev';
  await M.connect(uri);
  const db = M.connection.db;
  const names = await db.listCollections().toArray();
  console.log('collections:', names.map(c => c.name).join(', ') || '(none)');
  for (const c of names) {
    const stats = await db.command({ count: c.name }).catch(e => null);
    const n = stats && typeof stats === 'object' ? stats.n : '?';
    console.log(`- ${c.name}: ${n} docs`);
  }
  // Sample sessions (public metadata only)
  try {
    const sessions = await M.connection.collection('sessions').find(
      {}, { projection: { sessionId: 1, title: 1, status: 1, type: 1, createdAt: 1, updatedAt: 1 }, limit: 20, sort: { updatedAt: -1 } }
    ).toArray();
    console.log('\nsessions:');
    for (const s of sessions) {
      console.log(`  ${s.sessionId} | "${s.title}" | status=${s.status} | type=${s.type || '?'} | updated=${s.updatedAt ? new Date(s.updatedAt).toISOString() : '?'}`);
    }
  } catch (e) { console.log('sessions read failed:', e.message); }
  try {
    const results = await M.connection.collection('results').find(
      {}, { projection: { sessionId: 1, title: 1, winner: 1, completedAt: 1 }, limit: 20 }
    ).toArray();
    console.log('\nresults:');
    for (const r of results) console.log(`  ${r.sessionId} | "${r.title}" | winner=${r.winner}`);
  } catch (e) { console.log('results read failed:', e.message); }
  try {
    const users = await M.connection.collection('users').find(
      {}, { projection: { email: 1, name: 1, username: 1, createdAt: 1 }, limit: 20 }
    ).toArray();
    console.log('\nusers (emails truncated):');
    for (const u of users) console.log(`  ${String(u.email).slice(0, 4)}***${String(u.email).split('@')[1] || ''} | name=${u.name} | created=${u.createdAt ? new Date(u.createdAt).toISOString() : '?'}`);
  } catch (e) { console.log('users read failed:', e.message); }
  try {
    const nOtp = await db.command({ count: 'otpchallenges' }).catch(() => null);
    console.log('\notpchallenges count:', nOtp && typeof nOtp === 'object' ? nOtp.n : 'collection absent');
  } catch {}
  try {
    const nPart = await db.command({ count: 'voteparticipations' }).catch(() => null);
    console.log('voteparticipations count:', nPart && typeof nPart === 'object' ? nPart.n : 'collection absent');
  } catch {}
  try {
    const nVote = await db.command({ count: 'votes' }).catch(() => null);
    console.log('votes count:', nVote && typeof nVote === 'object' ? nVote.n : 'collection absent');
  } catch {}
  await M.disconnect();
  process.exit(0);
})().catch(err => { console.error('FATAL', err.message); process.exit(1); });
