const SPREADSHEET_ID = "1qkz3Oy66p4uhXWLuORk_BK-MtppZ0-bhi0gQXdP7Shw";

const SHEET_CLUBS = "Clubs";
const SHEET_OFFICERS = "Officers";
const SHEET_VERIFICATION = "Verification";
const SHEET_AUDIT = "Audit";

const ADMIN_TOKEN = "Apples123";

/* =========================
   ENTRY
========================= */

function doGet(e) {
  const p = normalizeParams_(e);
  const action = (p.action || "").toLowerCase();

  if (!action) {
    return ContentService
      .createTextOutput("Open Road Registry API")
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    if (action === "search") return respond_(p, searchClubs_(p));
    if (action === "club") return respond_(p, getClubPublic_(p));
    if (action === "register") return respond_(p, registerClub_(p));
    if (action === "get_challenge") return respond_(p, getChallenge_(p));
    if (action === "confirm") return respond_(p, confirmVerification_(p));
    if (action === "update_profile") return respond_(p, updateProfile_(p));

    return respond_(p, { ok:false, error:"unknown action" });
  } catch(err) {
    return respond_(p, { ok:false, error:String(err) });
  }
}

/* =========================
   JSON / JSONP
========================= */

function respond_(p, obj) {
  const payload = obj || {};
  const cb = String(p.callback || "").trim();

  if (cb && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(cb)) {
    const js = cb + "(" + JSON.stringify(payload) + ");";
    return ContentService
      .createTextOutput(js)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================
   HELPERS
========================= */

function normalizeParams_(e) {
  const out = {};
  const q = e && e.parameter ? e.parameter : {};
  Object.keys(q).forEach(k => out[k] = q[k]);
  return out;
}

function nowIso_() { return new Date().toISOString(); }

function getSs_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getSheet_(name) {
  const sh = getSs_().getSheetByName(name);
  if (!sh) throw new Error("Missing sheet " + name);
  return sh;
}

function getHeaderMap_(sh) {
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h,i)=> map[h]=i+1);
  return map;
}

function appendRow_(sh,obj){
  const map=getHeaderMap_(sh);
  const row=[];
  Object.keys(map).forEach(h=>{
    row[map[h]-1]=obj[h]||"";
  });
  sh.appendRow(row);
}

function findRow_(sh,col,val){
  const map=getHeaderMap_(sh);
  const c=map[col];
  const last=sh.getLastRow();
  if(!c||last<2) return null;
  const vals=sh.getRange(2,c,last-1,1).getValues();
  for(let i=0;i<vals.length;i++){
    if(String(vals[i][0])===String(val)) return i+2;
  }
  return null;
}

function readAll_(sh){
  const last=sh.getLastRow();
  if(last<2) return [];
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const data=sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  return data.map(r=>{
    const o={};
    headers.forEach((h,i)=>o[h]=r[i]);
    return o;
  });
}

/* =========================
   CORE LOGIC
========================= */

function registerClub_(p){
  const name=String(p.name||"").trim();
  const presUuid=String(p.president_uuid||"").trim();
  if(!name||!presUuid) return {ok:false,error:"missing fields"};

  const sh=getSheet_(SHEET_CLUBS);
  const rows=readAll_(sh);
  if(rows.find(r=>String(r.name).toLowerCase()===name.toLowerCase()))
    return {ok:false,error:"name conflict"};

  const clubId="ORR"+Utilities.getUuid().slice(0,6).toUpperCase();
  const token=Utilities.getUuid().replace(/-/g,"");
  const ts=nowIso_();

  appendRow_(sh,{
    club_id:clubId,
    name:name,
    founded_date:p.founded_date||"",
    alignment:p.alignment||"neutral",
    visibility:p.visibility||"public",
    status:"pending",
    patch_url:p.patch_url||"",
    colors:p.colors||"",
    description:p.description||"",
    president_uuid:presUuid,
    president_name:p.president_name||"",
    auth_token:token,
    verified_at:"",
    last_heartbeat:"",
    created_at:ts,
    updated_at:ts
  });

  const challenge="ORR-"+Utilities.getUuid().slice(0,4).toUpperCase();
  appendRow_(getSheet_(SHEET_VERIFICATION),{
    club_id:clubId,
    challenge_code:challenge,
    challenge_expires:"",
    verified_at:""
  });

  return {ok:true,club_id:clubId,token:token,challenge:challenge};
}

function getChallenge_(p){
  const clubId=p.club_id;
  const sh=getSheet_(SHEET_VERIFICATION);
  const row=findRow_(sh,"club_id",clubId);
  if(!row) return {ok:false,error:"not found"};
  const map=getHeaderMap_(sh);
  const code=sh.getRange(row,map.challenge_code).getValue();
  return {ok:true,challenge:code};
}

function confirmVerification_(p){
  const clubId=p.club_id;
  const token=p.token;
  const code=p.challenge_code;

  const clubs=getSheet_(SHEET_CLUBS);
  const row=findRow_(clubs,"club_id",clubId);
  if(!row) return {ok:false,error:"club not found"};

  const map=getHeaderMap_(clubs);
  if(clubs.getRange(row,map.auth_token).getValue()!==token)
    return {ok:false,error:"bad token"};

  const ver=getSheet_(SHEET_VERIFICATION);
  const vrow=findRow_(ver,"club_id",clubId);
  const vmap=getHeaderMap_(ver);
  if(ver.getRange(vrow,vmap.challenge_code).getValue()!==code)
    return {ok:false,error:"bad code"};

  const ts=nowIso_();
  clubs.getRange(row,map.status).setValue("verified");
  clubs.getRange(row,map.verified_at).setValue(ts);

  return {ok:true,verified_at:ts};
}

function updateProfile_(p){
  const clubId=p.club_id;
  const token=p.token;

  const sh=getSheet_(SHEET_CLUBS);
  const row=findRow_(sh,"club_id",clubId);
  if(!row) return {ok:false,error:"not found"};

  const map=getHeaderMap_(sh);
  if(sh.getRange(row,map.auth_token).getValue()!==token)
    return {ok:false,error:"bad token"};

  ["patch_url","colors","description","alignment","visibility"].forEach(f=>{
    if(p[f]!==undefined)
      sh.getRange(row,map[f]).setValue(p[f]);
  });

  return {ok:true};
}

function getClubPublic_(p){
  const clubId=p.club_id;
  const sh=getSheet_(SHEET_CLUBS);
  const row=findRow_(sh,"club_id",clubId);
  if(!row) return {ok:false,error:"not found"};

  const map=getHeaderMap_(sh);
  if(sh.getRange(row,map.visibility).getValue()!=="public")
    return {ok:false,error:"not public"};

  const obj={};
  Object.keys(map).forEach(k=>{
    obj[k]=sh.getRange(row,map[k]).getValue();
  });

  return {ok:true,club:obj};
}

function searchClubs_(){
  const rows=readAll_(getSheet_(SHEET_CLUBS));
  const list=rows.filter(r=>r.visibility==="public");
  return {ok:true,count:list.length,items:list};
}
