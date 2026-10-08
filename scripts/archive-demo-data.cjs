/*
 * Presentation data cleanup for votesphere_dev.
 *
 * ARCHIVE-FIRST, REVERSIBLE: every document matching the demo/test signatures
 * below is moved into dedicated `archive_*` collections in the same database.
 * Nothing is deleted; the server simply stops seeing it because it queries the
 * live collections only.
 *
 * Kept automatically:
 * - seed sessions sess_default ("Danny Boyle Film Tournament") and
 *   sess_horror ("Horror Classics") — live demo content the user chose to keep
 * - sessionallowlistentries allowlist rows that belong to the seed sessions
 *   (none expected — seeds are public — but guarded anyway)
 *
 * Archived (test/demo residue):
 * 1. sessions  : every sessionId except the two seeds
 * 2. results   : every sessionId except the two seeds
 * 3. users     : OTP test accounts (pattern-matched e-mails used by specs)
 * 4. sessionjoinrequests: rows referencing archived sessions, plus test e-mails
 * 5. sessionallowlistentries: rows referencing archived sessions
 * 6. voteparticipations : rows referencing archived sessions
 *
 * Run with --commit to actually write; default is DRY-RUN (prints counts only).
 * Run with --restore to copy everything back out of the archive collections.
 */
const path = require('path');
const M = require(path.join(__dirname, '..', 'voting-server', 'node_modules', 'mongoose'));

const SEED_SESSION_IDS = ['sess_default', 'sess_horror'];

// E-mail patterns the verification suites used for OTP test users.
const TEST_EMAIL_PATTERNS = [
  /@voter\.test$/i,
  /@example\.com$/i,
  /@example\.org$/i,
  /^verify-test/i,
  /(^|\.)test(@|$)/i
];

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const RESTORE = args.includes('--restore');

async function isArchived(db, archiveName, filter) {
  return (await db.collection(archiveName).countDocuments(filter)) > 0;
}

async function archiveOne(db, liveName, archiveName, doc) {
  const filter = liveName === 'users'
    ? { _id: doc._id }
    : liveName === 'results'
      ? { sessionId: doc.sessionId }
      : { _id: doc._id };
  await db.collection(archiveName).updateOne(
    { _id: doc._id },
    { $setOnInsert: { ...doc } },
    { upsert: true }
  );
  await db.collection(liveName).deleteOne(filter);
}

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/votesphere_dev';
  await M.connect(uri);
  const db = M.connection.db;

  const summary = [];

  if (args.includes('--reset-seeds')) {
    // Demo-reset: archive the two seed session documents and any result rows
    // that belong to them. The startup bootstrap then recreates both sessions
    // from entries.json / HORROR_SESSION_ENTRIES with full entries and fresh
    // join codes, so the demo starts pristine every time.
    for (const sid of SEED_SESSION_IDS) {
      const s = await db.collection('sessions').findOne({ sessionId: sid });
      if (s) await archiveOne(db, 'sessions', 'archive_sessions', s);
      const r = await db.collection('results').findOne({ sessionId: sid });
      if (r) await archiveOne(db, 'results', 'archive_results', r);
      console.log(`archived seed "${sid}" (session doc + result row, if any)`);
    }
    const left = await db.collection('sessions').countDocuments({});
    console.log(`live sessions remaining: ${left} (bootstrap recreates the seeds on next server start)`);
    await M.disconnect();
    process.exit(0);
  }

  if (RESTORE) {
    for (const pair of [
      ['archive_sessions', 'sessions'],
      ['archive_results', 'results'],
      ['archive_users', 'users'],
      ['archive_sessionjoinrequests', 'sessionjoinrequests'],
      ['archive_sessionallowlistentries', 'sessionallowlistentries'],
      ['archive_voteparticipations', 'voteparticipations']
    ]) {
      const docs = await db.collection(pair[0]).find({}).toArray();
      let restored = 0;
      for (const doc of docs) {
        const filter = pair[1] === 'users' ? { email: doc.email } : { _id: doc._id };
        const existing = await db.collection(pair[1]).countDocuments(filter);
        if (!existing) {
          await db.collection(pair[1]).insertOne(doc);
          restored++;
        }
      }
      summary.push(`${pair[0]} -> ${pair[1]}: restored ${restored} doc(s)`);
    }
    console.log(summary.join('\n'));
    await M.disconnect();
    process.exit(0);
  }

  // ---- sessions ----
  const sessions = await db.collection('sessions').find(
    { sessionId: { $nin: SEED_SESSION_IDS } },
    { projection: { sessionId: 1 } }
  ).toArray();
  const sessionIds = sessions.map(s => s.sessionId);
  summary.push(`sessions to archive: ${sessionIds.length}`);

  // ---- results (by sessionId) ----
  const results = await db.collection('results').find(
    { sessionId: { $nin: SEED_SESSION_IDS } },
    { projection: { sessionId: 1 } }
  ).toArray();
  summary.push(`results to archive: ${results.length}`);

  // ---- users (test e-mail patterns) ----
  const or = TEST_EMAIL_PATTERNS.map(p => ({ email: p }));
  const users = await db.collection('users').find({ $or: or }).toArray();
  const userEmails = users.map(u => u.email);
  summary.push(`users to archive: ${userEmails.length} (of ${(await db.collection('users').countDocuments({}))} total)`);

  // ---- join requests: archived sessions or test users ----
  const joinRequests = await db.collection('sessionjoinrequests').find({}).toArray();
  const jrToArchive = joinRequests.filter(r => {
    const sid = r.sessionId || r.session_id || r.sessionID;
    if (sid && sessionIds.includes(sid)) return true;
    const em = (r.email || '').toLowerCase();
    return TEST_EMAIL_PATTERNS.some(p => p.test(em));
  });
  summary.push(`sessionjoinrequests to archive: ${jrToArchive.length} (of ${joinRequests.length} total)`);

  // ---- allowlist entries: archived sessions or test users ----
  const allow = await db.collection('sessionallowlistentries').find({}).toArray();
  const allowToArchive = allow.filter(a => {
    const sid = a.sessionId || a.session_id;
    if (sid && sessionIds.includes(sid)) return true;
    const em = (a.email || '').toLowerCase();
    return TEST_EMAIL_PATTERNS.some(p => p.test(em));
  });
  summary.push(`sessionallowlistentries to archive: ${allowToArchive.length} (of ${allow.length} total)`);

  // ---- participations: archived sessions ----
  const parts = await db.collection('voteparticipations').find({}).toArray();
  const partToArchive = parts.filter(p => sessionIds.includes(p.sessionId));
  summary.push(`voteparticipations to archive: ${partToArchive.length} (of ${parts.length} total)`);

  console.log('\n=== DRY RUN (pass --commit to execute, --restore to undo) ===');
  console.log(summary.join('\n'));

  if (!COMMIT) {
    await M.disconnect();
    process.exit(0);
  }

  const log = [];
  for (const doc of sessions) {
    const full = await db.collection('sessions').findOne({ sessionId: doc.sessionId });
    await archiveOne(db, 'sessions', 'archive_sessions', full);
  }
  log.push(`archived sessions: ${sessions.length}`);
  for (const doc of results) {
    const full = await db.collection('results').findOne({ sessionId: doc.sessionId });
    if (full) await archiveOne(db, 'results', 'archive_results', full);
  }
  log.push(`archived results: ${results.length}`);
  for (const doc of users) {
    await archiveOne(db, 'users', 'archive_users', doc);
  }
  log.push(`archived users: ${users.length}`);
  for (const doc of jrToArchive) {
    await archiveOne(db, 'sessionjoinrequests', 'archive_sessionjoinrequests', doc);
  }
  log.push(`archived join requests: ${jrToArchive.length}`);
  for (const doc of allowToArchive) {
    await archiveOne(db, 'sessionallowlistentries', 'archive_sessionallowlistentries', doc);
  }
  log.push(`archived allowlist entries: ${allowToArchive.length}`);
  for (const doc of partToArchive) {
    await archiveOne(db, 'voteparticipations', 'archive_voteparticipations', doc);
  }
  log.push(`archived voteparticipations: ${partToArchive.length}`);

  // Sanity: what remains live
  const liveSessions = await db.collection('sessions').countDocuments({});
  const liveUsers = await db.collection('users').countDocuments({});
  const liveResults = await db.collection('results').countDocuments({});
  log.push(`\nLIVE after commit: sessions=${liveSessions}, users=${liveUsers}, results=${liveResults}`);

  console.log(log.join('\n'));
  await M.disconnect();
  process.exit(0);
})().catch(err => { console.error('FATAL', err); process.exit(1); });
