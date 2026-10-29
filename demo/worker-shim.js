/* GetBlessed demo: the artifact host serves .txt but not .gz, so the language
   model ships as base64 text. Answer the reader's request for the .gz from it. */
(function () {
  var realFetch = self.fetch.bind(self);
  self.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (/eng\.traineddata\.gz$/.test(url)) {
      return realFetch(url.replace(/\.gz$/, ".txt"), init).then(function (resp) {
        if (!resp.ok) return resp;
        return resp.text().then(function (b64) {
          var bin = atob(b64.trim()), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Response(bytes, { status: 200 });
        });
      });
    }
    return realFetch(input, init);
  };
})();
