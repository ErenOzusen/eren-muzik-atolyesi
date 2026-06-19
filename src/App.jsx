import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
  const isAdminPage = window.location.pathname === "/admin";

  const [contactForm, setContactForm] = useState({
  name: "",
  phone: "",
  lesson: "",
  message: "",
});

const [submissions, setSubmissions] = useState([]);
const [adminPassword, setAdminPassword] = useState("");
const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
const [adminToken, setAdminToken] = useState("");



const handleContactSubmit = async (e) => {
  e.preventDefault();

  try {
    const response = await fetch("https://eren-muzik-atolyesi-backend.onrender.com/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contactForm),
    });

    const data = await response.json();

    if (data.success) {
      alert("Başvurunuz başarıyla gönderildi.");
      setContactForm({
        name: "",
        phone: "",
        lesson: "",
        message: "",
      });
    }
  } catch (error) {
    console.error("Form gönderilirken hata oluştu:", error);
    alert("Bir hata oluştu. Lütfen tekrar deneyin.");
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
      setSubmissions(data);
    } else {
      alert(data.message || "Başvurular alınamadı");
    }
  } catch (error) {
    console.error("Başvurular alınamadı:", error);
    alert("Başvurular alınırken bir hata oluştu");
  }
};

const handleDeleteSubmission = async (index) => {
  const confirmDelete = window.confirm("Bu başvuruyu silmek istiyor musun?");

  if (!confirmDelete) return;

  try {
const response = await fetch(
  `https://eren-muzik-atolyesi-backend.onrender.com/api/submissions/${index}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  }
);

    const data = await response.json();

    if (data.success) {
      fetchSubmissions();
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

useEffect(() => {
  fetchSubmissions();
}, []);


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

if (isAdminPage) {
  return (
    <div className="admin-page">
      <div className="admin-panel">
        <h1>Admin Panel</h1>
        <p>Eren Müzik Atölyesi başvuruları</p>

        {!isAdminLoggedIn ? (
          <form onSubmit={handleAdminLogin} className="admin-login-form">
            <input
              type="password"
              placeholder="Admin şifresi"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />

            <button type="submit">Giriş Yap</button>
          </form>
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
  </tr>
</thead>

              <tbody>
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan="6">Henüz başvuru yok.</td>
                  </tr>
                ) : (
                  submissions.map((item, index) => (
                    <tr key={index}>
  <td>{item.name}</td>
  <td>{item.phone}</td>
  <td>{item.lesson}</td>
  <td>{item.message}</td>
  <td>{new Date(item.date).toLocaleString("tr-TR")}</td>
  <td>
    <button
      className="delete-button"
      onClick={() => handleDeleteSubmission(index)}
    >
      Sil
    </button>
  </td>
</tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

  <button type="submit">Başvuru Gönder</button>
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