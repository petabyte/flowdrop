const rateLimit = require('express-rate-limit');

/** General API rate limiter: 100 requests per 15 minutes per IP */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'You have exceeded 100 requests in 15 minutes. Please slow down.',
  },
});

/** Stricter limiter for upload endpoint: 30 uploads per 15 minutes per IP */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Uploads',
    message: 'Upload limit reached (30 per 15 min). Please wait before uploading more files.',
  },
});

/** Auth limiter: 10 attempts per 15 minutes per IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too Many Requests', message: 'Too many attempts, please try again later.' },
});

module.exports = { apiLimiter, uploadLimiter, authLimiter };
