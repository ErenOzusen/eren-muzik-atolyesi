import { useEffect, useState } from "react";
import "./App.css";

const WHATSAPP_PREFILL_MESSAGE =
  "Merhaba, Eren Müzik Atölyesi'ne yaptığınız başvuru için size ulaşıyorum.";

function normalizePhoneForWhatsApp(phone) {
  if (!phone || typeof phone !== "string") return null;

  let digits = phone.replace(/[\s\-().]/g, "").replace(/^\+/, "");

  if (!digits || !/^\d+$/.test(digits)) return null;

  if (digits.startsWith("0")) {
    digits = "90" + digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith("5")) {
    digits = "90" + digits;
  }

  if (digits.length < 10 || digits.length > 15) return null;

  return digits;
}

function buildWhatsAppLink(phone) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;

  const text = encodeURIComponent(WHATSAPP_PREFILL_MESSAGE);
  return `https://wa.me/${normalizedPhone}?text=${text}`;
}

function getSubmissionDate(submission) {
  return submission?.date || submission?.createdAt || null;
}

function normalizeLessonName(lesson) {
  return (lesson || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getLessonStatCategory(lesson) {
  const normalized = normalizeLessonName(lesson);
  if (!normalized) return null;

  if (normalized.includes("bas") && normalized.includes("gitar")) {
    return "Bas Gitar";
  }

  if (normalized.includes("piyano")) {
    return "Piyano";
  }

  if (
    normalized.includes("müzik teorisi") ||
    normalized.includes("muzik teorisi")
  ) {
    return "Müzik Teorisi";
  }

  if (normalized.includes("gitar")) {
    return "Gitar";
  }

  return null;
}

function computeSubmissionStats(submissions) {
  const stats = {
    total: submissions.length,
    gitar: 0,
    piyano: 0,
    basGitar: 0,
    muzikTeorisi: 0,
  };

  submissions.forEach((item) => {
    const category = getLessonStatCategory(item.lesson);

    if (category === "Gitar") stats.gitar += 1;
    else if (category === "Piyano") stats.piyano += 1;
    else if (category === "Bas Gitar") stats.basGitar += 1;
    else if (category === "Müzik Teorisi") stats.muzikTeorisi += 1;
  });

  return stats;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");

  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    lesson: "",
    message: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
const [formStatus, setFormStatus] = useState({
  type: "",
  message: "",
});


  const [submissions, setSubmissions] = useState([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lessonFilter, setLessonFilter] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  const isAdminPage = window.location.pathname === "/admin";

  const lessonFilterOptions = [
    ...new Set([
      "Gitar",
      "Piyano",
      "Bas Gitar",
      "Müzik Teorisi",
      ...submissions.map((item) => item.lesson).filter(Boolean),
    ]),
  ];

  const filteredSubmissions = submissions.filter((item) => {
    if (lessonFilter && item.lesson !== lessonFilter) {
      return false;
    }

    const search = searchTerm.toLowerCase();
    if (!search) return true;

    const name = item.name || "";
    const phone = item.phone || "";
    const lesson = item.lesson || "";
    const message = item.message || "";

    return (
      name.toLowerCase().includes(search) ||
      phone.toLowerCase().includes(search) ||
      lesson.toLowerCase().includes(search) ||
      message.toLowerCase().includes(search)
    );
  });

  const submissionStats = computeSubmissionStats(submissions);

  const statCards = [
    { label: "Toplam Başvuru", value: submissionStats.total, variant: "total" },
    { label: "Gitar", value: submissionStats.gitar },
    { label: "Piyano", value: submissionStats.piyano },
    { label: "Bas Gitar", value: submissionStats.basGitar },
    { label: "Müzik Teorisi", value: submissionStats.muzikTeorisi },
  ];




const handleContactSubmit = async (e) => {
  e.preventDefault();

  if (isSubmitting) return;

  setIsSubmitting(true);
  setFormStatus({
    type: "",
    message: "",
  });

  try {
    const response = await fetch("https://eren-muzik-atolyesi-backend.onrender.com/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contactForm),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error("Başvuru gönderilemedi");
    }

    setFormStatus({
      type: "success",
      message: "Başvurunuz başarıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.",
    });

    setContactForm({
      name: "",
      phone: "",
      lesson: "",
      message: "",
    });

    setTimeout(() => {
  setFormStatus({
    type: "",
    message: "",
  });
}, 6000);

  } catch (error) {
    console.error("Form gönderilirken hata oluştu:", error);

    setFormStatus({
      type: "error",
      message: "Başvuru gönderilirken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  } finally {
    setIsSubmitting(false);
  }
};

const fetchSubmissions = async (token = adminToken) => {
  try {
    const response = await fetch(
      "https://eren-muzik-atolyesi-backend.onrender.com/api/submissions",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();

    if (response.ok) {
      setSubmissions(Array.isArray(data) ? data : []);
    } else {
      alert(data.message || "Başvurular alınamadı");
    }
  } catch (error) {
    console.error("Başvurular alınamadı:", error);
    alert("Başvurular alınırken bir hata oluştu");
  }
};

const handleStatusChange = async (id, newStatus) => {
  if (!adminToken) {
    return;
  }

  try {
    const response = await fetch(
  `https://eren-muzik-atolyesi-backend.onrender.com/api/submissions/${id}/status`,
  {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.message || "Başvuru durumu güncellenemedi");
      return;
    }

    setSubmissions((prevSubmissions) =>
      prevSubmissions.map((submission) =>
        submission._id === id
          ? { ...submission, status: data.submission?.status || newStatus }
          : submission
      )
    );
  } catch (error) {
    console.error("Durum güncelleme hatası:", error);
    alert("Başvuru durumu güncellenirken bir hata oluştu");
  }
};

const handleDeleteSubmission = async (id) => {
  const confirmDelete = window.confirm("Bu başvuruyu silmek istiyor musun?");

  if (!confirmDelete) return;

  try {
const response = await fetch(
  `https://eren-muzik-atolyesi-backend.onrender.com/api/submissions/${id}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  }
);

    const data = await response.json();

if (data.success) {
  if (selectedSubmission?._id === id) {
    setSelectedSubmission(null);
  }
  fetchSubmissions(adminToken);
} else {
  alert(data.message);
}
  } catch (error) {
    console.error("Başvuru silinemedi:", error);
    alert("Başvuru silinirken hata oluştu");
  }
};

const handleAdminLogin = async (e) => {
  e.preventDefault();



  try {
    const response = await fetch(
      "https://eren-muzik-atolyesi-backend.onrender.com/api/admin/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: adminPassword,
        }),
      }
    );

    const data = await response.json();

    if (data.success) {
  setAdminToken(data.token);
  setIsAdminLoggedIn(true);
  fetchSubmissions(data.token);
} else {
      alert("Şifre yanlış kral");
    }
  } catch (error) {
    console.error("Admin giriş hatası:", error);
    alert("Admin girişi sırasında bir hata oluştu");
  }
};

  const handleAdminLogout = () => {
  setIsAdminLoggedIn(false);
  setAdminToken("");
  setAdminPassword("");
  setSearchTerm("");
  setLessonFilter("");
  setSelectedSubmission(null);
  setSubmissions([]);
};

  useEffect(() => {
  const revealElements = document.querySelectorAll(".reveal");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("show");
        }
      });
    },
    {
      threshold: 0.15,
    }
  );

  revealElements.forEach((element) => {
    observer.observe(element);
  });

  return () => {
    revealElements.forEach((element) => {
      observer.unobserve(element);
    });
  };
}, []);

  useEffect(() => {
  const handleScroll = () => {
    const sections = [
      "hero",
      "hakkimda",
      "dersler",
      "paketler",
      "yorumlar",
      "sss",
      "iletisim",
    ];

    

    let currentSection = "hero";

    sections.forEach((sectionId) => {
      const section = document.getElementById(sectionId);

      if (section) {
        const sectionTop = section.offsetTop - 120;

        if (window.scrollY >= sectionTop) {
          currentSection = sectionId;
        }
      }
    });

    setActiveSection(currentSection);
  };

  window.addEventListener("scroll", handleScroll);

  return () => {
    window.removeEventListener("scroll", handleScroll);
  };
}, []);

  useEffect(() => {
    if (!selectedSubmission) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setSelectedSubmission(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedSubmission]);

if (isAdminPage) {
  return (
    <div className="admin-page">
      {!isAdminLoggedIn ? (
        <div className="admin-login-card">
          <p className="admin-eyebrow">Yönetim Paneli</p>
          <h1>Admin Girişi</h1>
          <p className="admin-login-text">
            Eren Müzik Atölyesi başvurularını görüntülemek ve yönetmek için
            şifrenizi girin.
          </p>

          <form onSubmit={handleAdminLogin} className="admin-login-form">
            <input
              type="password"
              placeholder="Admin şifresi"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />

            <button type="submit">Giriş Yap</button>
          </form>
        </div>
      ) : (
        <div className="admin-dashboard">
      <div className="admin-dashboard-header">
  <div>
    <p className="admin-eyebrow">Başvuru Yönetimi</p>
    <h1>Gelen Başvurular</h1>
    <p>
      Form üzerinden gelen öğrenci başvurularını buradan takip edebilirsin.
    </p>
  </div>

  <div className="admin-header-actions">
    <button
      type="button"
      className="admin-logout-button"
      onClick={handleAdminLogout}
    >
      Çıkış Yap
    </button>
  </div>
</div>

          <div className="admin-stats-grid">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`admin-stat-card${
                  card.variant === "total" ? " admin-stat-card-total" : ""
                }`}
              >
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <div className="admin-filters">
  <div className="admin-search-box">
    <input
      type="text"
      placeholder="İsim, telefon, ders veya mesaj ara..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />
  </div>

  <div className="admin-lesson-filter">
    <label htmlFor="lesson-filter">Ders türü</label>
    <select
      id="lesson-filter"
      value={lessonFilter}
      onChange={(e) => setLessonFilter(e.target.value)}
    >
      <option value="">Tüm dersler</option>
      {lessonFilterOptions.map((lesson) => (
        <option key={lesson} value={lesson}>
          {lesson}
        </option>
      ))}
    </select>
  </div>
</div>

       {submissions.length === 0 ? (
  <div className="admin-empty">
    Henüz başvuru bulunmuyor.
  </div>
) : filteredSubmissions.length === 0 ? (
  <div className="admin-empty">
    Seçilen ders veya arama kriterine uygun başvuru bulunamadı.
  </div>
) : (
  <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                  <th>Ad Soyad</th>
<th>Telefon</th>
<th>Ders</th>
<th>Mesaj</th>
<th>Tarih</th>
<th>Durum</th>
<th>İşlem</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSubmissions.map((item) => {
                    const whatsappLink = buildWhatsAppLink(item.phone);

                    return (
                     <tr key={item._id}>
                      <td data-label="Ad Soyad">{item.name}</td>
                      <td data-label="Telefon">{item.phone}</td>
                      <td data-label="Ders">{item.lesson}</td>
                      <td className="admin-message-cell" data-label="Mesaj">
                        {item.message}
                      </td>
                      <td data-label="Tarih">

  {getSubmissionDate(item)
    ? new Date(getSubmissionDate(item)).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    : "—"}
</td>

<td>
  <select
    className="admin-status-select"
    value={item.status || "Yeni"}
    onChange={(event) =>
      handleStatusChange(item._id, event.target.value)
    }
  >
    <option value="Yeni">Yeni</option>
    <option value="Arandı">Arandı</option>
    <option value="Beklemede">Beklemede</option>
    <option value="Derse başladı">Derse başladı</option>
    <option value="İptal">İptal</option>
  </select>
</td>
                      <td className="admin-actions-cell" data-label="İşlem">
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-detail-button"
                            aria-label={`${item.name || "Başvuru"} detaylarını görüntüle`}
                            onClick={() => setSelectedSubmission(item)}
                          >
                            Detay Gör
                          </button>
                          {whatsappLink ? (
                            <a
                              href={whatsappLink}
                              className="admin-whatsapp-button"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              WhatsApp
                            </a>
                          ) : (
                            <span
                              className="admin-whatsapp-button disabled"
                              title="Geçerli telefon numarası yok"
                            >
                              WhatsApp
                            </span>
                          )}
                          <button
                            className="admin-delete-button"
                            onClick={() => handleDeleteSubmission(item._id)}
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedSubmission && (
        <div
          className="admin-modal-overlay"
          onClick={() => setSelectedSubmission(null)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div>
                <p className="admin-eyebrow">Başvuru Detayı</p>
                <h2 id="admin-modal-title">
                  {selectedSubmission.name || "İsimsiz Başvuru"}
                </h2>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                aria-label="Başvuru detayını kapat"
                onClick={() => setSelectedSubmission(null)}
              >
                ×
              </button>
            </div>

            <div className="admin-modal-body">
              <div className="admin-modal-field">
                <span className="admin-modal-label">Ad Soyad</span>
                <p>{selectedSubmission.name || "—"}</p>
              </div>

              <div className="admin-modal-field">
                <span className="admin-modal-label">Telefon</span>
                <p>{selectedSubmission.phone || "—"}</p>
              </div>

              <div className="admin-modal-field">
                <span className="admin-modal-label">Ders</span>
                <p>{selectedSubmission.lesson || "—"}</p>
              </div>

              <div className="admin-modal-field">
                <span className="admin-modal-label">Tarih</span>
                <p>
                  {getSubmissionDate(selectedSubmission)
                    ? new Date(getSubmissionDate(selectedSubmission)).toLocaleString(
                        "tr-TR",
                        {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )
                    : "—"}
                </p>
              </div>

              <div className="admin-modal-field admin-modal-field-full">
                <span className="admin-modal-label">Mesaj</span>
                <p className="admin-modal-message">
                  {selectedSubmission.message || "—"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

  return (
    <div className="app">

<nav className="navbar">
  <div className="navbar-logo">Eren Müzik Atölyesi</div>

  <button
    className="menu-toggle"
    onClick={() => setMenuOpen(!menuOpen)}
  >
    ☰
  </button>

  <div className={menuOpen ? "navbar-links active" : "navbar-links"}>
    <a
  href="#hero"
  className={activeSection === "hero" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("hero");
    setMenuOpen(false);
  }}
>
  Ana Sayfa
</a>

<a
  href="#hakkimda"
  className={activeSection === "hakkimda" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("hakkimda");
    setMenuOpen(false);
  }}
>
  Hakkımda
</a>

<a
  href="#dersler"
  className={activeSection === "dersler" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("dersler");
    setMenuOpen(false);
  }}
>
  Dersler
</a>

<a
  href="#paketler"
  className={activeSection === "paketler" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("paketler");
    setMenuOpen(false);
  }}
>
  Paketler
</a>

<a
  href="#yorumlar"
  className={activeSection === "yorumlar" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("yorumlar");
    setMenuOpen(false);
  }}
>
  Yorumlar
</a>

<a
  href="#sss"
  className={activeSection === "sss" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("sss");
    setMenuOpen(false);
  }}
>
  SSS
</a>

<a
  href="#iletisim"
  className={activeSection === "iletisim" ? "active-link" : ""}
  onClick={() => {
    setActiveSection("iletisim");
    setMenuOpen(false);
  }}
>
  İletişim
</a>
  </div>
</nav>

   <section id="hero" className="hero">
  <div className="hero-content">
    <h1>Eren Müzik Atölyesi</h1>
    <p>Gitar, piyano ve müzik teorisi dersleriyle müziğe ilk adımı atın.</p>

    <div className="hero-buttons">
      <a href="#iletisim" className="hero-button">
        Ders Almak İstiyorum
      </a>

      <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20m%C3%BCzik%20dersleri%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="whatsapp-button"
>
  WhatsApp’tan Yaz
</a>

   
    </div>
  </div>

  <div className="hero-image">
    <img src="/music-hero.png" alt="Müzik dersi" />
  </div>
</section>

<section className="features">
  <h2>Neden Eren Müzik Atölyesi?</h2>

  <div className="feature-list">
    <div className="feature-card">
      <span className="feature-icon">🎵</span>
      <h3>Birebir Ders</h3>
      <p>Her öğrencinin seviyesine ve hedefine göre özel ders programı hazırlanır.</p>
    </div>

    <div className="feature-card">
      <span className="feature-icon">👶</span>
      <h3>Çocuklara Uygun</h3>
      <p>Çocukların yaşına, ilgisine ve öğrenme hızına uygun keyifli müzik eğitimi sunulur.</p>
    </div>

    <div className="feature-card">
      <span className="feature-icon">📍</span>
      <h3>Esnek Ders Seçenekleri</h3>
      <p>Ankara’da yüz yüze veya ihtiyaca göre online ders seçenekleriyle eğitim alınabilir.</p>
    </div>
  </div>
</section>

            <section id="hakkimda" className="about reveal">
        <h2>Hakkımda</h2>
        <p>
          Ben Eren. Müzik öğretmeniyim. Gitar, piyano ve bas gitar alanlarında
          birebir özel dersler veriyorum. Derslerimde öğrencinin seviyesine göre
          adım adım ilerleyen, anlaşılır ve keyifli bir eğitim süreci sunuyorum.
        </p>
      </section>

      <section id="dersler" className="lessons reveal">
  <h2>Derslerimiz</h2>

  <div className="lesson-list">
    <div className="lesson-card">
      <div className="lesson-icon">🎸</div>
      <h3>Gitar Dersi</h3>
      <p>Başlangıç ve orta seviye gitar eğitimi.</p>

<a
  href="https://wa.me/905558089585?text=Merhaba%2C%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Bilgi Al
</a>
    </div>
    

    <div className="lesson-card">
      <div className="lesson-icon">🎹</div>
      <h3>Piyano Dersi</h3>
      <p>Temel piyano teknikleri, nota okuma ve repertuvar çalışmaları.</p>

      <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20piyano%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Bilgi Al
</a>
    </div>


    <div className="lesson-card">
      <div className="lesson-icon">🎸</div>
      <h3>Bas Gitar Dersi</h3>
      <p>Ritim, groove, temel teknikler ve şarkı eşlik çalışmaları.</p>

    <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20bas%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Bilgi Al
</a>
    </div>
  
  </div>
</section>

            <section id="paketler" className="packages reveal">
  <h2>Ders Paketleri</h2>

  <div className="package-list">
    <div className="package-card">
      <div className="package-icon">🥉</div>
      <h3>Başlangıç Paketi</h3>
      <p>Gitar, piyano veya bas gitara yeni başlayan öğrenciler için temel eğitim.</p>
<span className="package-badge">Seviyeye göre planlanır</span>     

 <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20Ba%C5%9Flang%C4%B1%C3%A7%20Paketi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Paket Bilgisi Al
</a>
    </div>

    <div className="package-card">
      <div className="package-icon">🥈</div>
      <h3>Gelişim Paketi</h3>
      <p>Temel bilgisi olan öğrenciler için teknik, repertuvar ve müzikal gelişim çalışmaları.</p>
<span className="package-badge">Birebir özel program</span>     

<a
  href="https://wa.me/905558089585?text=Merhaba%2C%20Geli%C5%9Fim%20Paketi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Paket Bilgisi Al
</a>
    </div>

    <div className="package-card">
      <div className="package-icon">🥇</div>
      <h3>Çocuklar İçin Müzik</h3>
      <p>Çocukların yaşına ve ilgisine uygun eğlenceli müzik eğitimi.</p>
<span className="package-badge">Keyifli ve öğretici dersler</span>     

 <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20%C3%87ocuklar%20i%C3%A7in%20m%C3%BCzik%20dersleri%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="lesson-button"
>
  Paket Bilgisi Al
</a>
    </div>
  </div>
</section>

<section id="surec" className="process-section reveal">
  <div className="section-header">
    <span className="section-badge">Ders Süreci</span>
    <h2>Ders Süreci Nasıl İşliyor?</h2>
    <p>
      Her öğrenci için hedefe, seviyeye ve müzik zevkine göre ilerleyen
      kişisel bir ders planı oluşturulur.
    </p>
  </div>

  <div className="process-grid">
    <div className="process-card">
      <div className="process-number">01</div>
      <h3>Tanışma ve Hedef Belirleme</h3>
      <p>
        Öğrencinin seviyesi, müzik zevki ve hedefleri birlikte değerlendirilir.
      </p>
    </div>

    <div className="process-card">
      <div className="process-number">02</div>
      <h3>Kişiye Özel Ders Planı</h3>
      <p>
        Gitar, piyano veya müzik teorisi dersleri öğrencinin hızına göre
        planlanır.
      </p>
    </div>

    <div className="process-card">
      <div className="process-number">03</div>
      <h3>Düzenli Takip ve Gelişim</h3>
      <p>
        Her derste ilerleme takip edilir, pratik önerileriyle gelişim
        desteklenir.
      </p>
    </div>
  </div>
</section>

<section id="yorumlar" className="testimonials reveal">
  <div className="section-header">
    <span className="section-badge">Öğrenci Yorumları</span>
    <h2>Öğrenciler Ne Diyor?</h2>
    <p>
      Eren Müzik Atölyesi’nde ders alan öğrencilerin deneyimlerinden bazıları.
    </p>
  </div>

  <div className="testimonial-list">
    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Gitar derslerinde kısa sürede çok ilerledim. Dersler hem keyifli
        hem de çok anlaşılır geçiyor.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">A</div>
        <div>
          <h4>Ali K.</h4>
          <span>Gitar Öğrencisi</span>
        </div>
      </div>
    </div>

    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Çocuğum derslere severek katılıyor. Müzikle ilgisi arttı ve özgüveni
        gelişti.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">Z</div>
        <div>
          <h4>Zeynep A.</h4>
          <span>Veli Yorumu</span>
        </div>
      </div>
    </div>

    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Dersler motive edici ve öğrenci seviyesine göre ilerliyor. Başlamak
        isteyenlere kesinlikle öneririm.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">M</div>
        <div>
          <h4>Mehmet T.</h4>
          <span>Piyano Öğrencisi</span>
        </div>
      </div>
    </div>
  </div>

  <p className="testimonial-note">
    * Yorumlar örnek olarak hazırlanmıştır. Gerçek öğrenci yorumları geldikçe
    güncellenebilir.
  </p>
</section>

<section id="sss" className="faq reveal">
  <h2>Sık Sorulan Sorular</h2>

  <div className="faq-list">
    <div className="faq-item">
      <h3>Dersler kimler için uygundur?</h3>
      <p>
        Dersler başlangıç seviyesinden ileri seviyeye kadar her yaş grubuna uygun şekilde planlanır.
      </p>
    </div>

    <div className="faq-item">
      <h3>Dersler birebir mi yapılıyor?</h3>
      <p>
        Evet, dersler öğrencinin seviyesine ve hedeflerine göre birebir olarak planlanır.
      </p>
    </div>

    <div className="faq-item">
      <h3>Çocuklar için müzik dersi var mı?</h3>
      <p>
        Evet, çocukların yaşına ve ilgisine uygun eğlenceli müzik dersleri yapılır.
      </p>
    </div>

    <div className="faq-item">
      <h3>Derse başlamak için enstrümanım olmak zorunda mı?</h3>
      <p>
        Başlangıç aşamasında süreç birlikte değerlendirilir. Uygun enstrüman seçimi konusunda yönlendirme yapılabilir.
      </p>
    </div>
  </div>
  <div className="faq-cta">
  <p>Aklınıza takılan başka bir soru mu var?</p>

<a
  href="https://wa.me/905558089585?text=Merhaba%2C%20akl%C4%B1ma%20tak%C4%B1lan%20bir%20soru%20var.%20Bilgi%20alabilir%20miyim%3F"
  target="_blank"
  rel="noopener noreferrer"
  className="whatsapp-button"
>
  WhatsApp’tan Sor
</a>
</div>
</section>

<section id="iletisim" className="contact reveal">
  <h2>İletişim</h2>
  <p>
    Dersler hakkında bilgi almak veya deneme dersi için benimle iletişime geçebilirsiniz.
  </p>

  <div className="contact-buttons">
    <a
  href="https://wa.me/905558089585?text=Merhaba%2C%20dersler%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  target="_blank"
  rel="noopener noreferrer"
  className="contact-button"
>
  WhatsApp ile Yaz
</a>
  </div>

  <form className="contact-form" onSubmit={handleContactSubmit}>
  <input
    type="text"
    placeholder="Ad Soyad"
    value={contactForm.name}
    onChange={(e) =>
      setContactForm({ ...contactForm, name: e.target.value })
    }
    required
  />

  <input
    type="tel"
    placeholder="Telefon"
    value={contactForm.phone}
    onChange={(e) =>
      setContactForm({ ...contactForm, phone: e.target.value })
    }
    required
  />

  <select
    value={contactForm.lesson}
    onChange={(e) =>
      setContactForm({ ...contactForm, lesson: e.target.value })
    }
    required
  >
    <option value="">Ders seçiniz</option>
    <option value="Gitar">Gitar</option>
    <option value="Piyano">Piyano</option>
    <option value="Bas Gitar">Bas Gitar</option>
    <option value="Müzik Teorisi">Müzik Teorisi</option>
  </select>

  <textarea
    placeholder="Mesajınız"
    value={contactForm.message}
    onChange={(e) =>
      setContactForm({ ...contactForm, message: e.target.value })
    }
    required
  />

{formStatus.message && (
  <p className={`form-message ${formStatus.type}`}>
    {formStatus.type === "success" && (
      <span className="success-icon">✓</span>
    )}
    {formStatus.message}
  </p>
)}
<button
  type="submit"
  disabled={isSubmitting}
>
  {isSubmitting ? "Gönderiliyor..." : "Başvuru Gönder"}
</button>

</form>
</section>

      <footer className="footer">
  <p>© 2026 Eren Müzik Atölyesi. Tüm hakları saklıdır.</p>

  <a href="/admin" className="admin-link">
    Yönetim
  </a>
</footer>
    </div>
  );
}

export default App;