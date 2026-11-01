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

})();
