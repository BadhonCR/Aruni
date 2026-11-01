(() => {
  const $ = (selector) => document.querySelector(selector);
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  const languageToggle = $("#languageToggle");
  if (languageToggle) {
    languageToggle.addEventListener("click", () => {
      const current = document.documentElement.lang === "en" ? "en" : "bn";
      const next = current === "bn" ? "en" : "bn";
      document.documentElement.lang = next;
      document.querySelectorAll("[data-bn][data-en]").forEach((node) => {
        node.innerHTML = node.dataset[next];
      });
      languageToggle.textContent = next === "bn" ? "EN" : "বাংলা";
    });
  }

  const configReady = window.ARUNI_SUPABASE_URL &&
    window.ARUNI_SUPABASE_PUBLISHABLE_KEY &&
    window.supabase?.createClient;

  if (!configReady) {
    document.querySelectorAll("[data-auth-status]").forEach((el) => {
      el.textContent = "Supabase connection configuration is missing.";
    });
    return;
  }

  const db = window.supabase.createClient(
    window.ARUNI_SUPABASE_URL,
    window.ARUNI_SUPABASE_PUBLISHABLE_KEY
  );
  window.aruniSupabase = db;

  const loginForm = $("#loginForm");
  if (loginForm) {
    const status = $("#loginStatus");
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = loginForm.querySelector('button[type="submit"]');
      const email = $("#email").value.trim();
      const password = $("#password").value;
      status.className = "alert alert-info mt-3";
      status.textContent = "লগইন যাচাই করা হচ্ছে…";
      button.disabled = true;
      const { error } = await db.auth.signInWithPassword({ email, password });
      button.disabled = false;
      if (error) {
        status.className = "alert alert-danger mt-3";
        status.textContent = error.message === "Invalid login credentials"
          ? "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।"
          : "লগইন করা যায়নি: " + error.message;
        return;
      }
      window.location.href = "dashboard.html";
    });
    db.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = "dashboard.html";
    });
  }

  const dashboard = $("#dashboardContent");
  if (dashboard) {
    const status = $("#dashboardStatus");
    const setStatus = (message, type = "info") => {
      status.className = "alert alert-" + type;
      status.textContent = message;
      status.hidden = false;
    };
    const money = (value) => new Intl.NumberFormat("en-BD", {
      style: "currency", currency: "BDT", maximumFractionDigits: 2
    }).format(Number(value || 0));
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const loadDashboard = async () => {
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      const session = sessionData?.session;
      if (sessionError || !session) {
        window.location.replace("login.html");
        return;
      }

      setStatus("আপনার তথ্য লোড হচ্ছে…");
      const user = session.user;
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("full_name, role, is_active, preferred_language")
        .eq("id", user.id).maybeSingle();

      if (profileError) {
        setStatus("প্রোফাইল পড়া যায়নি। Supabase schema চালানো হয়েছে কি না এবং RLS policy পরীক্ষা করুন। " + profileError.message, "danger");
        return;
      }
      if (!profile || !profile.is_active) {
        await db.auth.signOut();
        setStatus("এই অ্যাকাউন্টটি সক্রিয় নয়। প্রশাসকের সঙ্গে যোগাযোগ করুন।", "warning");
        return;
      }

      const role = profile.role || "member";
      const isStaff = role === "admin" || role === "manager";
      setText("memberName", profile.full_name || user.email || "সদস্য");
      setText("memberRole", role.toUpperCase());
      setText("memberEmail", user.email || "");
      setText("welcomeName", profile.full_name || "সদস্য");
      setText("roleNote", isStaff ? "আপনি ব্যবস্থাপনা-সংক্রান্ত তথ্য দেখতে পারবেন।" : "আপনি আপনার ব্যক্তিগত হিসাব ও অনুমোদিত সাধারণ তথ্য দেখতে পারবেন।");

      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
      setText("currentMonth", now.toLocaleDateString("bn-BD", { month: "long", year: "numeric" }));

      let memberId = null;
      if (!isStaff) {
        const { data: member } = await db.from("members").select("id")
          .eq("user_id", user.id).maybeSingle();
        memberId = member?.id || null;
      }

      let depositsQuery = db.from("deposits").select("amount").gte("paid_on", start).lt("paid_on", next);
      let mealsQuery = db.from("meal_entries").select("breakfast,lunch,dinner").gte("meal_date", start).lt("meal_date", next);
      if (!isStaff) {
        if (memberId) {
          depositsQuery = depositsQuery.eq("member_id", memberId);
          mealsQuery = mealsQuery.eq("member_id", memberId);
        } else {
          depositsQuery = null;
          mealsQuery = null;
        }
      }

      const [depositResult, expenseResult, mealResult, memberCountResult, noticeResult] = await Promise.all([
        depositsQuery ? depositsQuery : Promise.resolve({ data: [], error: null }),
        db.from("expenses").select("amount").gte("spent_on", start).lt("spent_on", next),
        mealsQuery ? mealsQuery : Promise.resolve({ data: [], error: null }),
        isStaff ? db.from("members").select("id", { count: "exact", head: true }).eq("status", "active") : Promise.resolve({ count: null, error: null }),
        db.from("notices").select("title,body,published_at").eq("is_published", true).order("published_at", { ascending: false }).limit(5)
      ]);

      const firstError = [depositResult, expenseResult, mealResult, memberCountResult, noticeResult].find(x => x.error);
      if (firstError) {
        setStatus("কিছু তথ্য লোড করা যায়নি: " + firstError.error.message + " — schema ও RLS policy যাচাই করুন।", "warning");
      } else {
        setStatus("Supabase-এর সঙ্গে সংযোগ সফল। প্রদর্শিত তথ্য ডেটাবেজ থেকে এসেছে।", "success");
      }

      const sum = (rows) => (rows || []).reduce((total, row) => total + Number(row.amount || 0), 0);
      const meals = (mealResult.data || []).reduce((total, row) =>
        total + Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0), 0);
      setText("depositTotal", money(sum(depositResult.data)));
      setText("expenseTotal", money(sum(expenseResult.data)));
      setText("mealTotal", new Intl.NumberFormat("bn-BD").format(meals));
      setText("memberTotal", isStaff && memberCountResult.count != null
        ? new Intl.NumberFormat("bn-BD").format(memberCountResult.count) : "—");
      setText("memberStatNote", isStaff ? "সক্রিয় সদস্য" : "শুধু ব্যবস্থাপনা দেখতে পাবে");

      const noticeList = $("#noticeList");
      if (noticeList) {
        noticeList.replaceChildren();
        (noticeResult.data || []).forEach((notice) => {
          const article = document.createElement("article");
          article.className = "notice-item";
          const heading = document.createElement("h3");
          heading.textContent = notice.title;
          const body = document.createElement("p");
          body.textContent = notice.body;
          article.append(heading, body);
          noticeList.append(article);
        });
        if (!noticeResult.data?.length) noticeList.textContent = "এখনো কোনো প্রকাশিত নোটিশ নেই।";
      }
    };

    $("#signOutButton")?.addEventListener("click", async () => {
      const { error } = await db.auth.signOut();
      if (error) setStatus("লগআউট করা যায়নি: " + error.message, "danger");
      else window.location.replace("login.html");
    });
    loadDashboard().catch((error) => setStatus("অপ্রত্যাশিত সমস্যা: " + error.message, "danger"));
    db.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) window.location.replace("login.html");
    });
  }

  const membersPage = $("#membersPage");
  if (membersPage) {
    const statusBox = $("#membersStatus"), form = $("#memberForm"), tbody = $("#membersTableBody"), saveButton = $("#saveMemberButton");
    $("#signOutButton").addEventListener("click", async () => { const {error}=await db.auth.signOut(); if(error) notify("লগআউট করা যায়নি: "+error.message,"danger"); else window.location.replace("login.html"); });
    let editingId = null, cachedMembers = [];
    const notify = (message, type = "info") => { statusBox.className = "alert alert-" + type; statusBox.textContent = message; statusBox.hidden = false; };
    const renderMembers = (items) => {
      tbody.replaceChildren();
      if (!items.length) { const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=7;cell.className="text-center text-muted py-4";cell.textContent="কোনো সদস্য পাওয়া যায়নি।";row.append(cell);tbody.append(row);return; }
      items.forEach((m) => {
        const row=document.createElement("tr");
        [m.member_code||"—",m.full_name,m.phone||"—",m.room_no||"—",({active:"সক্রিয়",former:"সাবেক",suspended:"স্থগিত"})[m.status]||m.status,m.joining_date||"—"].forEach(v=>{const td=document.createElement("td");td.textContent=v;row.append(td);});
        const td=document.createElement("td"),btn=document.createElement("button");btn.type="button";btn.className="btn btn-sm btn-outline-success";btn.textContent="সম্পাদনা";btn.addEventListener("click",()=>startEdit(m));td.append(btn);row.append(td);tbody.append(row);
      });
    };
    const loadMembers = async () => {
      const {data,error}=await db.from("members").select("id,member_code,full_name,phone,email,room_no,joining_date,leaving_date,status,notes,user_id").order("full_name",{ascending:true});
      if(error){notify("সদস্য তালিকা লোড করা যায়নি: "+error.message,"danger");return;}
      cachedMembers=data||[];renderMembers(cachedMembers);$("#memberCountLabel").textContent="মোট "+cachedMembers.length+" জন সদস্য";
    };
    const resetForm = () => { editingId=null;form.reset();$("#memberFormTitle").textContent="নতুন সদস্য যোগ করুন";saveButton.textContent="সদস্য সংরক্ষণ"; };
    const startEdit = (m) => { editingId=m.id;["member_code","full_name","phone","email","room_no","joining_date","leaving_date","status","notes"].forEach(k=>{const el=form.elements.namedItem(k);if(el)el.value=m[k]||(k==="status"?"active":"");});$("#memberFormTitle").textContent="সদস্যের তথ্য সম্পাদনা";saveButton.textContent="পরিবর্তন সংরক্ষণ";window.scrollTo({top:0,behavior:"smooth"}); };
    form.addEventListener("submit",async(e)=>{
      e.preventDefault();const v=Object.fromEntries(new FormData(form).entries());
      const payload={member_code:v.member_code.trim()||null,full_name:v.full_name.trim(),phone:v.phone.trim()||null,email:v.email.trim()||null,room_no:v.room_no.trim()||null,joining_date:v.joining_date||null,leaving_date:v.leaving_date||null,status:v.status,notes:v.notes.trim()||null};
      if(!payload.full_name){notify("সদস্যের নাম লিখুন।","warning");return;}
      saveButton.disabled=true;
      const result=editingId?await db.from("members").update(payload).eq("id",editingId):await db.from("members").insert(payload);
      saveButton.disabled=false;
      if(result.error){notify("সংরক্ষণ করা যায়নি: "+result.error.message,"danger");return;}
      notify(editingId?"সদস্যের তথ্য আপডেট হয়েছে।":"নতুন সদস্য যোগ হয়েছে।","success");resetForm();await loadMembers();
    });
    $("#cancelMemberEdit").addEventListener("click",resetForm);
    $("#memberSearch").addEventListener("input",e=>{const q=e.target.value.trim().toLocaleLowerCase();renderMembers(cachedMembers.filter(m=>[m.full_name,m.member_code,m.phone,m.room_no,m.status].some(v=>String(v||"").toLocaleLowerCase().includes(q))));});
    (async()=>{
      const {data:s}=await db.auth.getSession();if(!s.session){window.location.replace("login.html");return;}
      const {data:p,error}=await db.from("profiles").select("role,is_active").eq("id",s.session.user.id).maybeSingle();
      if(error||!p||!p.is_active||!["admin","manager"].includes(p.role)){notify("এই পৃষ্ঠাটি শুধু Admin ও Manager ব্যবহার করতে পারবেন।","danger");setTimeout(()=>window.location.replace("dashboard.html"),1800);return;}
      await loadMembers();
    })().catch(e=>notify("সমস্যা হয়েছে: "+e.message,"danger"));
  }


  const accountsPage = $("#accountsPage");
  if (accountsPage) {
    const statusBox=$("#accountsStatus"), monthInput=$("#accountMonth"), memberSelect=$("#depositMember");
    const depositForm=$("#depositForm"), expenseForm=$("#expenseForm");
    const money=v=>new Intl.NumberFormat("en-BD",{style:"currency",currency:"BDT",maximumFractionDigits:2}).format(Number(v||0));
    const notify=(message,type="info")=>{statusBox.className="alert alert-"+type;statusBox.textContent=message;statusBox.hidden=false;};
    const monthBounds=()=>{const value=monthInput.value;if(!value)return null;const [y,m]=value.split("-").map(Number);return {start:value+"-01",next:new Date(y,m,1).toISOString().slice(0,10)};};
    let currentMonthId=null, members=[];
    const ensureMonth=async()=>{
      const bounds=monthBounds();if(!bounds)throw new Error("প্রথমে মাস নির্বাচন করুন।");
      const {data:found,error}=await db.from("mess_months").select("id,status").eq("month_start",bounds.start).maybeSingle();
      if(error)throw error;
      if(found){currentMonthId=found.id;if(found.status!=="open")throw new Error("এই মাসের হিসাব বন্ধ করা হয়েছে।");return found.id;}
      const {data:created,error:createError}=await db.from("mess_months").insert({month_start:bounds.start,status:"open"}).select("id,status").single();
      if(createError)throw createError;currentMonthId=created.id;return created.id;
    };
    const loadMembersForSelect=async()=>{
      const {data,error}=await db.from("members").select("id,full_name,member_code").eq("status","active").order("full_name");
      if(error)throw error;members=data||[];
      memberSelect.replaceChildren();const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="সদস্য নির্বাচন করুন";memberSelect.append(placeholder);
      members.forEach(m=>{const o=document.createElement("option");o.value=m.id;o.textContent=(m.member_code?m.member_code+" — ":"")+m.full_name;memberSelect.append(o);});
    };
    const loadLedger=async()=>{
      const bounds=monthBounds();if(!bounds)return;
      const {data:month,error:monthError}=await db.from("mess_months").select("id,status").eq("month_start",bounds.start).maybeSingle();
      if(monthError)throw monthError;
      currentMonthId=month?.id||null;
      $("#monthState").textContent=month?(month.status==="open"?"চলমান":"বন্ধ"):"এখনো খোলা হয়নি";
      if(!month){$("#depositRows").textContent="এই মাসে কোনো জমা নেই।";$("#expenseRows").textContent="এই মাসে কোনো খরচ নেই।";$("#depositSum").textContent=money(0);$("#expenseSum").textContent=money(0);return;}
      const [d,e]=await Promise.all([
        db.from("deposits").select("*").eq("mess_month_id",month.id).order("paid_on",{ascending:false}),
        db.from("expenses").select("*").eq("mess_month_id",month.id).order("spent_on",{ascending:false})
      ]);
      if(d.error)throw d.error;if(e.error)throw e.error;
      const memberMap=new Map(members.map(m=>[m.id,m]));
      const depositRows=$("#depositRows");depositRows.replaceChildren();
      (d.data||[]).forEach(item=>{const tr=document.createElement("tr"),m=memberMap.get(item.member_id);[item.paid_on,m?.full_name||"সদস্য",item.payment_method,money(item.amount),item.note||""].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);});depositRows.append(tr);});
      if(!d.data?.length)depositRows.textContent="এই মাসে কোনো জমা নেই।";
      const expenseRows=$("#expenseRows");expenseRows.replaceChildren();
      (e.data||[]).forEach(item=>{const tr=document.createElement("tr");[item.spent_on,item.title,item.category,money(item.amount),item.note||""].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);});expenseRows.append(tr);});
      if(!e.data?.length)expenseRows.textContent="এই মাসে কোনো খরচ নেই।";
      $("#depositSum").textContent=money((d.data||[]).reduce((s,x)=>s+Number(x.amount),0));
      $("#expenseSum").textContent=money((e.data||[]).reduce((s,x)=>s+Number(x.amount),0));
    };
    monthInput.addEventListener("change",()=>loadLedger().catch(e=>notify("হিসাব লোড হয়নি: "+e.message,"danger")));
    depositForm.addEventListener("submit",async ev=>{
      ev.preventDefault();const v=Object.fromEntries(new FormData(depositForm).entries());
      try{const monthId=await ensureMonth();const {data:s}=await db.auth.getSession();
        const {error}=await db.from("deposits").insert({member_id:v.member_id,mess_month_id:monthId,amount:Number(v.amount),paid_on:v.paid_on,payment_method:v.payment_method,reference:v.reference||null,note:v.note||null,recorded_by:s.session.user.id});
        if(error)throw error;notify("জমার তথ্য সংরক্ষিত হয়েছে।","success");depositForm.reset();await loadLedger();
      }catch(e){notify("জমা সংরক্ষণ করা যায়নি: "+e.message,"danger");}
    });
    expenseForm.addEventListener("submit",async ev=>{
      ev.preventDefault();const v=Object.fromEntries(new FormData(expenseForm).entries());
      try{const monthId=await ensureMonth();const {data:s}=await db.auth.getSession();
        const {error}=await db.from("expenses").insert({mess_month_id:monthId,title:v.title,category:v.category,amount:Number(v.amount),spent_on:v.spent_on,note:v.note||null,recorded_by:s.session.user.id});
        if(error)throw error;notify("খরচের তথ্য সংরক্ষিত হয়েছে।","success");expenseForm.reset();await loadLedger();
      }catch(e){notify("খরচ সংরক্ষণ করা যায়নি: "+e.message,"danger");}
    });
    (async()=>{
      const {data:s}=await db.auth.getSession();if(!s.session){window.location.replace("login.html");return;}
      const {data:p,error}=await db.from("profiles").select("role,is_active").eq("id",s.session.user.id).maybeSingle();
      if(error||!p||!p.is_active||!["admin","manager"].includes(p.role)){notify("এই পৃষ্ঠা শুধু Admin ও Manager ব্যবহার করতে পারবেন।","danger");setTimeout(()=>window.location.replace("dashboard.html"),1800);return;}
      const today=new Date();monthInput.value=today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0");
      await loadMembersForSelect();await loadLedger();
    })().catch(e=>notify("অ্যাকাউন্ট পৃষ্ঠা চালু হয়নি: "+e.message,"danger"));
  }


  const mealsPage = $("#mealsPage");
  if (mealsPage) {
    const statusBox=$("#mealsStatus"), monthInput=$("#mealMonth"), dateInput=$("#mealDate");
    const form=$("#dailyMealForm"), memberSelect=$("#mealMember"), saveButton=$("#saveMealButton");
    const money=v=>new Intl.NumberFormat("en-BD",{style:"currency",currency:"BDT",maximumFractionDigits:2}).format(Number(v||0));
    const bn=v=>new Intl.NumberFormat("bn-BD",{maximumFractionDigits:1}).format(Number(v||0));
    const notify=(message,type="info")=>{statusBox.className="alert alert-"+type;statusBox.textContent=message;statusBox.hidden=false;};
    const bounds=()=>{if(!monthInput.value)return null;const parts=monthInput.value.split("-").map(Number);return {start:monthInput.value+"-01",next:new Date(parts[0],parts[1],1).toISOString().slice(0,10)};};
    let members=[], monthRecord=null, dailyEntries=[];
    const ensureMonth=async()=>{
      const b=bounds();if(!b)throw new Error("প্রথমে হিসাবের মাস নির্বাচন করুন।");
      const {data:found,error}=await db.from("mess_months").select("id,status").eq("month_start",b.start).maybeSingle();
      if(error)throw error;
      if(found){monthRecord=found;if(found.status!=="open")throw new Error("এই মাসের হিসাব বন্ধ; মিল পরিবর্তন করা যাবে না।");return found.id;}
      const {data:created,error:createError}=await db.from("mess_months").insert({month_start:b.start,status:"open"}).select("id,status").single();
      if(createError)throw createError;monthRecord=created;return created.id;
    };
    const loadMembers=async()=>{
      const {data,error}=await db.from("members").select("id,member_code,full_name").eq("status","active").order("full_name");
      if(error)throw error;members=data||[];memberSelect.replaceChildren();
      const option=document.createElement("option");option.value="";option.textContent="সদস্য নির্বাচন করুন";memberSelect.append(option);
      members.forEach(m=>{const o=document.createElement("option");o.value=m.id;o.textContent=(m.member_code?m.member_code+" — ":"")+m.full_name;memberSelect.append(o);});
    };
    const renderDaily=()=>{
      const body=$("#dailyMealRows");body.replaceChildren();
      if(!dailyEntries.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=7;td.className="text-center text-muted";td.textContent="এই তারিখে কোনো মিল এন্ট্রি নেই।";tr.append(td);body.append(tr);}
      dailyEntries.forEach(entry=>{
        const m=members.find(x=>x.id===entry.member_id), total=Number(entry.breakfast)+Number(entry.lunch)+Number(entry.dinner), tr=document.createElement("tr");
        [m?.full_name||"সদস্য",bn(entry.breakfast),bn(entry.lunch),bn(entry.dinner),bn(total),entry.note||"—"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);});
        const action=document.createElement("td"),btn=document.createElement("button");btn.type="button";btn.className="btn btn-sm btn-outline-success";btn.textContent="এডিট";btn.addEventListener("click",()=>{memberSelect.value=entry.member_id;form.elements.namedItem("breakfast").value=entry.breakfast;form.elements.namedItem("lunch").value=entry.lunch;form.elements.namedItem("dinner").value=entry.dinner;form.elements.namedItem("note").value=entry.note||"";window.scrollTo({top:0,behavior:"smooth"});});action.append(btn);tr.append(action);body.append(tr);
      });
      $("#dailyMealCount").textContent="এন্ট্রি: "+bn(dailyEntries.length)+" জন";
    };
    const loadDaily=async()=>{
      const day=dateInput.value;if(!day)return;
      const {data,error}=await db.from("meal_entries").select("id,member_id,meal_date,breakfast,lunch,dinner,note").eq("meal_date",day).order("created_at");
      if(error)throw error;dailyEntries=data||[];renderDaily();
    };
    const loadReport=async()=>{
      const b=bounds();if(!b)return;
      const {data:month,error:monthError}=await db.from("mess_months").select("id,status").eq("month_start",b.start).maybeSingle();
      if(monthError)throw monthError;monthRecord=month||null;
      $("#mealMonthState").textContent=month?(month.status==="open"?"চলমান":"বন্ধ"):"এখনো খোলা হয়নি";
      if(!month){
        $("#monthMealTotal").textContent="০";$("#foodExpenseTotal").textContent=money(0);$("#mealRate").textContent=money(0);$("#monthDepositTotal").textContent=money(0);
        $("#memberMealReport").innerHTML='<tr><td colspan="5" class="text-center text-muted">এই মাসে কোনো হিসাব নেই।</td></tr>';return;
      }
      const results=await Promise.all([
        db.from("meal_entries").select("member_id,breakfast,lunch,dinner").gte("meal_date",b.start).lt("meal_date",b.next),
        db.from("expenses").select("amount").eq("mess_month_id",month.id).eq("category","food"),
        db.from("deposits").select("member_id,amount").eq("mess_month_id",month.id)
      ]);
      const failure=results.find(x=>x.error);if(failure)throw failure.error;
      const mealRows=results[0].data||[], foodRows=results[1].data||[], depositRows=results[2].data||[];
      const mealCount=mealRows.reduce((sum,x)=>sum+Number(x.breakfast||0)+Number(x.lunch||0)+Number(x.dinner||0),0);
      const foodCost=foodRows.reduce((sum,x)=>sum+Number(x.amount||0),0);
      const deposits=depositRows.reduce((sum,x)=>sum+Number(x.amount||0),0);
      const rate=mealCount>0?foodCost/mealCount:0;
      $("#monthMealTotal").textContent=bn(mealCount);$("#foodExpenseTotal").textContent=money(foodCost);$("#mealRate").textContent=money(rate);$("#monthDepositTotal").textContent=money(deposits);
      const perMember=new Map();
      mealRows.forEach(x=>{const v=perMember.get(x.member_id)||0;perMember.set(x.member_id,v+Number(x.breakfast||0)+Number(x.lunch||0)+Number(x.dinner||0));});
      const paid=new Map();depositRows.forEach(x=>paid.set(x.member_id,(paid.get(x.member_id)||0)+Number(x.amount||0)));
      const body=$("#memberMealReport");body.replaceChildren();
      if(!members.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="কোনো সক্রিয় সদস্য নেই।";tr.append(td);body.append(tr);return;}
      members.forEach(m=>{
        const count=perMember.get(m.id)||0,cost=count*rate,deposit=paid.get(m.id)||0,balance=deposit-cost,tr=document.createElement("tr");
        [m.full_name,bn(count),money(cost),money(deposit),money(balance)].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;if(i===4){td.className=balance>=0?"text-success fw-semibold":"text-danger fw-semibold";}tr.append(td);});body.append(tr);
      });
    };
    const refresh=async()=>{await loadDaily();await loadReport();};
    $("#signOutButton").addEventListener("click",async()=>{const {error}=await db.auth.signOut();if(error)notify("লগআউট করা যায়নি: "+error.message,"danger");else window.location.replace("login.html");});
    monthInput.addEventListener("change",async()=>{if(dateInput.value&&dateInput.value.slice(0,7)!==monthInput.value)dateInput.value=monthInput.value+"-01";try{await refresh();}catch(e){notify("হিসাব লোড হয়নি: "+e.message,"danger");}});
    dateInput.addEventListener("change",()=>loadDaily().catch(e=>notify("দৈনিক মিল লোড হয়নি: "+e.message,"danger")));
    form.addEventListener("submit",async event=>{
      event.preventDefault();const v=Object.fromEntries(new FormData(form).entries());
      if(!dateInput.value||dateInput.value.slice(0,7)!==monthInput.value){notify("এন্ট্রির তারিখ নির্বাচিত মাসের মধ্যে হতে হবে।","warning");return;}
      const numbers=["breakfast","lunch","dinner"].map(k=>Number(v[k]));
      if(numbers.some(n=>!Number.isFinite(n)||n<0)){notify("মিলের সংখ্যা সঠিকভাবে দিন।","warning");return;}
      saveButton.disabled=true;
      try{
        const monthId=await ensureMonth(),{data:s}=await db.auth.getSession();
        const payload={member_id:v.member_id,meal_date:dateInput.value,breakfast:numbers[0],lunch:numbers[1],dinner:numbers[2],note:v.note.trim()||null,recorded_by:s.session.user.id};
        const {error}=await db.from("meal_entries").upsert(payload,{onConflict:"member_id,meal_date"});
        if(error)throw error;notify("দৈনিক মিল সংরক্ষণ হয়েছে।","success");form.reset();await refresh();
      }catch(e){notify("মিল সংরক্ষণ করা যায়নি: "+e.message,"danger");}
      finally{saveButton.disabled=false;}
    });
    (async()=>{
      const {data:s}=await db.auth.getSession();if(!s.session){window.location.replace("login.html");return;}
      const {data:p,error}=await db.from("profiles").select("role,is_active").eq("id",s.session.user.id).maybeSingle();
      if(error||!p||!p.is_active||!["admin","manager"].includes(p.role)){notify("এই পৃষ্ঠা শুধু Admin ও Manager ব্যবহার করতে পারবেন।","danger");setTimeout(()=>window.location.replace("dashboard.html"),1800);return;}
      const today=new Date(),month=today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0");
      monthInput.value=month;dateInput.value=today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0")+"-"+String(today.getDate()).padStart(2,"0");
      await loadMembers();await refresh();
    })().catch(e=>notify("মিল ব্যবস্থাপনা চালু হয়নি: "+e.message,"danger"));
  }

})();