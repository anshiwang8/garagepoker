/**
 * Runs in <head> before anything paints, so the felt, card back and deck
 * colours chosen in this browser (lib/prefs.ts, key "gp.prefs") show from the
 * first frame. Plain ES5; any error leaves the defaults. Unknown values match
 * no CSS rule, so they're harmless.
 */
export const PREFS_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("gp.prefs")||"{}"),d=document.documentElement.dataset;["felt","back","deck","motion"].forEach(function(k){if(typeof p[k]==="string")d[k]=p[k]});if(typeof p.cardSize==="string")d.cards=p.cardSize}catch(e){}`;
