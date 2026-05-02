import pool from "../database/db.js";

// ── Admin <-> Seller direct chat ─────────────────────────────

export async function getOrCreateConversation(sellerId) {
  const { rows: existing } = await pool.query(
    `SELECT ac.id, s.name AS seller_name, s.email AS seller_email
     FROM admin_conversations ac
     JOIN sellers s ON s.id = ac.seller_id
     WHERE ac.seller_id = $1`, [sellerId]);
  if (existing[0]) return existing[0];

  const { rows } = await pool.query(
    `INSERT INTO admin_conversations (seller_id) VALUES ($1)
     RETURNING id`, [sellerId]);
  const { rows: seller } = await pool.query(
    `SELECT name AS seller_name, email AS seller_email FROM sellers WHERE id = $1`, [sellerId]);
  return { id: rows[0].id, ...seller[0] };
}

export async function getAllAdminConversations() {
  const { rows } = await pool.query(`
    SELECT ac.id, ac.seller_id, ac.updated_at,
           s.name AS seller_name, s.email AS seller_email,
           (SELECT body FROM admin_messages am
            WHERE am.conversation_id = ac.id ORDER BY am.created_at DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*) FROM admin_messages am
            WHERE am.conversation_id = ac.id AND am.sender = 'seller' AND am.read_at IS NULL) AS unread_count
    FROM admin_conversations ac
    JOIN sellers s ON s.id = ac.seller_id
    ORDER BY ac.updated_at DESC`);
  return rows;
}

export async function getAdminMessages(conversationId) {
  const { rows } = await pool.query(
    `SELECT id, sender, body, created_at, read_at
     FROM admin_messages WHERE conversation_id = $1 ORDER BY created_at ASC`, [conversationId]);
  return rows;
}

export async function sendAdminMessage(conversationId, sender, body) {
  const { rows } = await pool.query(
    `INSERT INTO admin_messages (conversation_id, sender, body) VALUES ($1, $2, $3) RETURNING *`,
    [conversationId, sender, body]);
  await pool.query(`UPDATE admin_conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  return rows[0];
}

export async function markAdminMessagesRead(conversationId, asSeenBySender) {
  // Mark messages from the OTHER side as read
  const otherSender = asSeenBySender === 'admin' ? 'seller' : 'admin';
  await pool.query(
    `UPDATE admin_messages SET read_at = now()
     WHERE conversation_id = $1 AND sender = $2 AND read_at IS NULL`,
    [conversationId, otherSender]);
}

// ── Monitor: sellers list + their conversations ──────────────

export async function getSellersForMonitor() {
  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.email,
           COUNT(DISTINCT c.id)::int AS conversation_count,
           MAX(c.updated_at)        AS last_activity
    FROM sellers s
    LEFT JOIN conversations c ON c.seller_id = s.id
    WHERE s.active = true
    GROUP BY s.id
    ORDER BY last_activity DESC NULLS LAST, s.name`);
  return rows;
}

export async function getConversationsBySeller(sellerId) {
  const { rows } = await pool.query(`
    SELECT c.id, c.customer_name, c.customer_email, c.created_at, c.updated_at,
           (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id)::int AS message_count
    FROM conversations c
    WHERE c.seller_id = $1
    ORDER BY c.updated_at DESC`, [sellerId]);
  return rows;
}

// ── Chat: all sellers (even without conversations) ───────────

export async function getAllSellersWithChatInfo() {
  const { rows } = await pool.query(`
    SELECT s.id AS seller_id, s.name AS seller_name, s.email AS seller_email,
           ac.id AS conversation_id, ac.updated_at,
           (SELECT am.body FROM admin_messages am
            WHERE am.conversation_id = ac.id ORDER BY am.created_at DESC LIMIT 1) AS last_message,
           COALESCE((SELECT COUNT(*) FROM admin_messages am
            WHERE am.conversation_id = ac.id AND am.sender = 'seller'
            AND am.read_at IS NULL), 0)::int AS unread_count
    FROM sellers s
    LEFT JOIN admin_conversations ac ON ac.seller_id = s.id
    WHERE s.active = true
    ORDER BY ac.updated_at DESC NULLS LAST, s.name`);
  return rows;
}

// ── Monitor customer <-> seller conversations ────────────────

export async function getMonitorConversations() {
  const { rows } = await pool.query(`
    SELECT c.id, c.seller_id, c.customer_name, c.customer_email, c.created_at, c.updated_at,
           s.name AS seller_name,
           (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM conversations c
    JOIN sellers s ON s.id = c.seller_id
    ORDER BY c.updated_at DESC`);
  return rows;
}

export async function getMonitorMessages(conversationId) {
  const { rows } = await pool.query(
    `SELECT id, sender, body, msg_type, created_at, read_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`, [conversationId]);
  return rows;
}

// ── Seller side: get/send messages with admin ────────────────

export async function getSellerAdminConversation(sellerId) {
  return getOrCreateConversation(sellerId);
}

export async function getSellerAdminMessages(sellerId) {
  const conv = await getOrCreateConversation(sellerId);
  return { conversationId: conv.id, messages: await getAdminMessages(conv.id) };
}

export async function sellerSendAdminMessage(sellerId, body) {
  const conv = await getOrCreateConversation(sellerId);
  return sendAdminMessage(conv.id, 'seller', body);
}

export async function getSellerUnreadAdminCount(sellerId) {
  const conv = await getOrCreateConversation(sellerId);
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS unread FROM admin_messages
     WHERE conversation_id = $1 AND sender = 'admin' AND read_at IS NULL`, [conv.id]);
  return Number(rows[0]?.unread || 0);
}
