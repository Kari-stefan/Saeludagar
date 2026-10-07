// A one-time message shown on the page after a redirect (src/views/partials/flash.ejs).
// Only a page that includes the partial uses it up.
export function setFlash(req, type, key, params = {}) {
  req.session.flash = { type, key, params };
}

export function flash(req, res, next) {
  res.locals.takeFlash = () => {
    const message = req.session.flash;
    delete req.session.flash;
    return message;
  };
  next();
}
