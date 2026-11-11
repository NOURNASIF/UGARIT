/* UGARIT M20 v1.51 — إعدادات العميل العامة فقط. لا تضع مفاتيح أو أسراراً هنا. */
(function(g){
  const defaults={apiBaseUrl:"",apiHealthPath:"/api/v1/health",requestTimeoutMs:8000,version:"0.1.21"};
  const supplied=g.UGARIT_CONFIG||{};
  g.UGARIT_CONFIG=Object.freeze({...defaults,...supplied});
})(window);
