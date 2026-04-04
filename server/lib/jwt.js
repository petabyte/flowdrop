const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'session';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function setSessionCookie(res, user) {
  const token = jwt.sign(
    { user_id: user.id, tier: user.tier },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { setSessionCookie, clearSessionCookie, verifyToken, COOKIE_NAME };
