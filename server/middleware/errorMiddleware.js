// CORS rejections must never leak a stack trace or internal detail to the
// client — respond with a plain, generic 403.
const corsErrorHandler = (err, req, res, next) => {
  if (err && err.message === "CORS: origin izinli değil") {
    return res.status(403).json({ success: false, message: "Yetkisiz kaynak" });
  }

  return next(err);
};

module.exports = { corsErrorHandler };
