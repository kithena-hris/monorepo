/**
 * J10b: `<script src="https://jobs.kithena.com/embed.js" data-company="acme">`
 * lists a company's jobs on its own site, in that site's own type and colour:
 * plain links, so the host page styles them.
 */
const SCRIPT = `(function () {
  var me = document.currentScript;
  var company = me && me.getAttribute('data-company');
  if (!company) return;
  var list = document.createElement('ul');
  list.className = 'kithena-jobs';
  me.parentNode.insertBefore(list, me);
  fetch(me.src.replace(/\\/embed\\.js.*$/, '') + '/embed/' + encodeURIComponent(company))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      (data.jobs || []).forEach(function (job) {
        var item = document.createElement('li');
        var link = document.createElement('a');
        link.href = job.url;
        link.textContent = job.title;
        var where = document.createElement('span');
        where.textContent = ' · ' + job.where;
        item.appendChild(link);
        item.appendChild(where);
        list.appendChild(item);
      });
    });
})();
`;

export function GET(): Response {
  return new Response(SCRIPT, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
