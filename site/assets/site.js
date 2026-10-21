// Simple photo pop-up for galleries (links marked data-lightbox).
document.addEventListener("click", function (e) {
  var a = e.target.closest("a[data-lightbox]");
  if (!a) return;
  e.preventDefault();
  var o = document.createElement("div");
  o.className = "lb";
  o.innerHTML = '<img alt="">';
  o.firstChild.src = a.href;
  o.addEventListener("click", function () { o.remove(); });
  document.addEventListener("keydown", function esc(k) { if (k.key === "Escape") { o.remove(); document.removeEventListener("keydown", esc); } });
  document.body.appendChild(o);
});
