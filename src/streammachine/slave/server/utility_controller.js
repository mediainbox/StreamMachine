module.exports = {
  index: (req, res) => {
    res.set("content-type", "text/html");
    res.set("connection", "close");
    return res.status(200).end(`
      <html>
        <head><title>StreamMachine</title></head>
        <body>
        <h1>OK</h1>
        </body>
      </html>`.trim()
    );
  },
  crossdomain: (req, res) => {
    res.set("content-type", "text/xml");
    res.set("connection", "close");
    return res.status(200).end(`<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy>
<allow-access-from domain="*" />
</cross-domain-policy>`);
  }
}
