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
})();
