import { useEffect, useState } from "react";
import {
  UserRound,
  Smile,
  MapPin,
  Guitar,
  Piano,
  AudioWaveform,
  Star,
  TrendingUp,
  MessageCircle,
  CalendarCheck,
} from "lucide-react";
import "./App.css";

const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:5000"
    : "https://eren-muzik-atolyesi-backend.onrender.com";

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
const getYoutubeVideoId = (url = "") => {
  const patterns = [
    /youtube\.com\/watch\?v=([^&?/]+)/,
    /youtube\.com\/shorts\/([^&?/]+)/,
    /youtube\.com\/embed\/([^&?/]+)/,
    /youtu\.be\/([^&?/]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return "";
};

const getYoutubeThumbnail = (url = "") => {
  const videoId = getYoutubeVideoId(url);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";
};

const getYoutubeEmbedUrl = (url = "") => {
  const videoId = getYoutubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
};

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
 const [playingVideoId, setPlayingVideoId] = useState(null);

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
  const [videos, setVideos] = useState([]);
  const [adminVideos, setAdminVideos] = useState([]);
const [videoForm, setVideoForm] = useState({
  title: "",
  description: "",
  videoUrl: "",
  thumbnailUrl: "",
  category: "",
  order: 0,
  isActive: true,
});
const [editingVideoId, setEditingVideoId] = useState(null);
const [videoFormStatus, setVideoFormStatus] = useState(null);
const [isVideoSubmitting, setIsVideoSubmitting] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(
  Boolean(localStorage.getItem("adminToken"))
);
  const [adminToken, setAdminToken] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lessonFilter, setLessonFilter] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  const [openFaqIndex, setOpenFaqIndex] = useState(null);

const toggleFaq = (index) => {
  setOpenFaqIndex((currentIndex) => (currentIndex === index ? null : index));
};


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

  const getYouTubeEmbedUrl = (url) => {
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtube.com")) {
      if (parsedUrl.pathname.startsWith("/shorts/")) {
        const videoId = parsedUrl.pathname.split("/shorts/")[1]?.split("?")[0];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
      }

      const videoId = parsedUrl.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }

    if (parsedUrl.hostname.includes("youtu.be")) {
      const videoId = parsedUrl.pathname.replace("/", "").split("?")[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }

    return url;
  } catch (error) {
    return "";
  }
};

const fetchVideos = async () => {
  try {
const response = await fetch(`${API_BASE_URL}/api/videos`);

    if (!response.ok) {
      throw new Error("Videolar alınamadı");
    }

    const data = await response.json();
    setVideos(data);
  } catch (error) {
    console.error("Videolar alınamadı:", error);
  }
};


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

const fetchAdminVideos = async (token = adminToken) => {
  try {
 const response = await fetch(`${API_BASE_URL}/api/admin/videos`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

    if (!response.ok) {
      throw new Error("Videolar alınamadı");
    }

    const data = await response.json();
    setAdminVideos(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("Admin videoları alınırken hata:", error);
  }
};

useEffect(() => {
  const savedToken = localStorage.getItem("adminToken");

  if (savedToken) {
    setAdminToken(savedToken);
    setIsAdminLoggedIn(true);
    fetchSubmissions(savedToken);
    fetchAdminVideos(savedToken);
  }
}, []);

const handleVideoFormChange = (e) => {
  const { name, value, type, checked } = e.target;

  setVideoForm((prevForm) => ({
    ...prevForm,
    [name]: type === "checkbox" ? checked : value,
  }));
};

const resetVideoForm = () => {
  setVideoForm({
    title: "",
    description: "",
    videoUrl: "",
    thumbnailUrl: "",
    category: "",
    order: "",
    isActive: true,
  });

  setEditingVideoId(null);
  
};

const handleVideoSubmit = async (e) => {
  e.preventDefault();

  if (!adminToken) {
    setVideoFormStatus("Admin oturumu bulunamadı. Lütfen tekrar giriş yap.");
    return;
  }

  if (!videoForm.title.trim() || !videoForm.videoUrl.trim()) {
    setVideoFormStatus("Başlık ve video linki zorunludur.");
    return;
  }

  setIsVideoSubmitting(true);
  setVideoFormStatus("");

  try {
   const videoPayload = {
  ...videoForm,
  order: videoForm.order === "" ? 0 : Number(videoForm.order),
};

const videoEndpoint = editingVideoId
  ? `${API_BASE_URL}/api/admin/videos/${editingVideoId}`
  : `${API_BASE_URL}/api/admin/videos`;

const response = await fetch(videoEndpoint, {
  method: editingVideoId ? "PATCH" : "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  },
  body: JSON.stringify(videoPayload),
});

    const data = await response.json();

  if (!response.ok) {
  setVideoFormStatus(
    editingVideoId
      ? "Bu video artık bulunamadı. Form temizlendi, yeniden ekleyebilirsin."
      : data.message || "Video eklenemedi."
  );

  if (editingVideoId) {
    resetVideoForm();
    fetchAdminVideos();
  }

  return;
}

    setVideoFormStatus("Video başarıyla eklendi.");setVideoFormStatus(
  editingVideoId ? "Video başarıyla güncellendi." : "Video başarıyla eklendi."
);
    resetVideoForm();
    fetchAdminVideos();
    fetchVideos();
  } catch (error) {
    console.error("Video ekleme hatası:", error);
    setVideoFormStatus("Video eklenirken bir hata oluştu.");
  } finally {
    setIsVideoSubmitting(false);
  }
};

const handleDeleteVideo = async (id) => {
  const confirmDelete = window.confirm("Bu videoyu silmek istiyor musun?");

  if (!confirmDelete) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/videos/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.message || "Video silinemedi.");
      return;
    }

    setAdminVideos((prevVideos) =>
  prevVideos.filter((video) => video.id !== id)
);

if (editingVideoId === id) {
  resetVideoForm();
}

fetchAdminVideos();
fetchVideos();
  } catch (error) {
    console.error("Video silme hatası:", error);
    alert("Video silinirken bir hata oluştu.");
  }
};

const handleEditVideo = (video) => {
  setEditingVideoId(video.id);

  setVideoForm({
    title: video.title || "",
    description: video.description || "",
    videoUrl: video.videoUrl || "",
    thumbnailUrl: video.thumbnailUrl || "",
    category: video.category || "",
    order: video.order || "",
    isActive: video.isActive,
  });

  setVideoFormStatus("Video düzenleme modunda.");
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
  localStorage.setItem("adminToken", data.token);
  setAdminToken(data.token);
  setIsAdminLoggedIn(true);
  fetchSubmissions(data.token);
  fetchAdminVideos(data.token);
} else {
      alert("Şifre yanlış kral");
    }
  } catch (error) {
    console.error("Admin giriş hatası:", error);
    alert("Admin girişi sırasında bir hata oluştu");
  }
};

  const handleAdminLogout = () => {
    localStorage.removeItem("adminToken");
  setIsAdminLoggedIn(false);
  setAdminToken("");
  setAdminPassword("");
  setSearchTerm("");
  setLessonFilter("");
  setSelectedSubmission(null);
  setSubmissions([]);
};

  useEffect(() => {
     fetchVideos();

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

    <div className="admin-video-management">
  <div className="admin-video-header">
    <div>
      <p className="admin-eyebrow">Video Galeri</p>
      <h2>Video Yönetimi</h2>
      <p>Atölye videolarını buradan ekleyebilir, düzenleyebilir ve silebilirsin.</p>
    </div>
  </div>

{videoFormStatus && (
  <p className="admin-video-status">
    {videoFormStatus}
  </p>
)}
<form className="admin-video-form" onSubmit={handleVideoSubmit}>    
  <input
  type="text"
  name="title"
  placeholder="Video başlığı"
  value={videoForm.title}
  onChange={handleVideoFormChange}
/>

    <input
  type="text"
  name="videoUrl"
  placeholder="YouTube / Shorts linki"
  value={videoForm.videoUrl}
  onChange={handleVideoFormChange}
/>

 <input
  type="text"
  name="category"
  placeholder="Kategori örn: Gitar, Piyano, Performans"
  value={videoForm.category}
  onChange={handleVideoFormChange}
/>

    <input
  type="number"
  name="order"
  placeholder="Sıra"
  value={videoForm.order}
  onChange={handleVideoFormChange}
/>
<input
  type="text"
  name="thumbnailUrl"
  placeholder="Thumbnail linki opsiyonel"
  value={videoForm.thumbnailUrl}
  onChange={handleVideoFormChange}
/>

    <textarea
  name="description"
  placeholder="Açıklama"
  value={videoForm.description}
  onChange={handleVideoFormChange}
/>

    <label className="admin-video-checkbox">
     <input
  type="checkbox"
  name="isActive"
  checked={videoForm.isActive}
  onChange={handleVideoFormChange}
/>
      Aktif olarak yayında göster
    </label>

    <button type="submit" disabled={isVideoSubmitting}>
  {isVideoSubmitting ? "Kaydediliyor..." : "Video Kaydet"}
</button>
  </form>
    <div className="admin-video-list">
    <h3>Eklenen Videolar</h3>

    {adminVideos.length === 0 ? (
      <p className="admin-empty-text">Henüz video eklenmedi.</p>
    ) : (
      adminVideos.map((video) => (
        <div key={video.id} className="admin-video-item">
  <div>
    <strong>{video.title}</strong>
    <p>{video.category || "Kategori yok"}</p>
    <small>{video.isActive ? "Aktif" : "Pasif"}</small>
  </div>
<div className="admin-video-actions">
  <button
    type="button"
    className="admin-video-edit-button"
    onClick={() => handleEditVideo(video)}
  >
    Düzenle
  </button>
  <button
    type="button"
    className="admin-video-delete-button"
    onClick={() => handleDeleteVideo(video.id)}
  >
    Sil
  </button>
</div>
</div>
      ))
    )}
  </div>
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

<a
  href="https://wa.me/905558089585?text=Merhaba%2C%20Eren%20M%C3%BCzik%20At%C3%B6lyesi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
  className="mobile-menu-whatsapp"
  target="_blank"
  rel="noopener noreferrer"
  onClick={() => setMenuOpen(false)}
>
  <span>Ders bilgisi al</span>
<small>WhatsApp’tan hemen yaz</small>
</a>
  </div>
</nav>

  <section id="hero" className="hero">
  <div className="hero-content">
    <span className="hero-badge">Ankara’da birebir müzik dersleri</span>

<h1>
  Gitar, Piyano ve Bas Gitarda Kişiye Özel Dersler
</h1>

<p>
  Çocuklar, gençler ve yetişkinler için; seviyeye, hedefe ve öğrenme hızına göre
  planlanan özel derslerle müziğe güvenle başlayın.
</p>

    <div className="hero-highlights">
  <span>Başlangıç ve orta seviye için uygun</span>
  <span>Deneyimli müzik öğretmeni</span>
  <span>Ücretsiz ön görüşme</span>
</div>

  <div className="hero-buttons">
  <a href="#iletisim" className="hero-button">
    <CalendarCheck size={18} strokeWidth={2.3} />
    Ücretsiz Ön Görüşme Al
  </a>

  <a
    href="https://wa.me/905558089585?text=Merhaba%2C%20m%C3%BCzik%20dersleri%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
    target="_blank"
    rel="noopener noreferrer"
    className="whatsapp-button"
  >
    <MessageCircle size={18} strokeWidth={2.3} />
    WhatsApp’tan Hızlı Bilgi Al
  </a>
</div>
  </div>

  <div className="hero-image">
    <img src="/music-hero.png" alt="Gitar, piyano ve bas gitar özel müzik dersi" />
  </div>
</section>

<section className="features">
  <h2>Neden Eren Müzik Atölyesi?</h2>

  <div className="feature-list">
  <div className="feature-card">
    <span className="feature-icon">
      <UserRound strokeWidth={2.2} />
    </span>
    <h3>Birebir Ders</h3>
    <p>Her öğrencinin seviyesine ve hedefine göre özel ders programı hazırlanır.</p>
  </div>

  <div className="feature-card">
    <span className="feature-icon">
      <Smile strokeWidth={2.2} />
    </span>
    <h3>Çocuklara Uygun</h3>
    <p>Çocukların yaşına, ilgisine ve öğrenme hızına uygun keyifli müzik eğitimi sunulur.</p>
  </div>

  <div className="feature-card">
    <span className="feature-icon">
      <MapPin strokeWidth={2.2} />
    </span>
    <h3>Esnek Ders Seçenekleri</h3>
    <p>Ankara’da yüz yüze veya ihtiyaca göre online ders seçenekleriyle eğitim alınabilir.</p>
  </div>
</div>
</section>
<section id="hakkimda" className="about reveal">
  <span className="section-badge">Hakkımda</span>
  <h2>Müziğin İçinden Gelen Bir Eğitim Anlayışı</h2>

  <p>
    Müzikle iç içe bir ailede büyüdüm. Dedem ve amcam TRT sanatçısıydı;
    ailemde birçok kişi müzikle yakından ilgilendi. Bu nedenle müzik,
    benim için küçük yaşlardan itibaren hayatın doğal bir parçası oldu.
  </p>

  <p>
    Çocukluk dönemimde TRT Çocuk Korosu’nda müzik eğitimime başladım,
    ardından TRT Gençlik Korosu’nda yer alarak koro disiplini, sahne
    deneyimi ve Türk sanat müziği repertuvarıyla güçlü bir temel kazandım.
  </p>

  <p>
    Müzik eğitimimi konservatuvar süreciyle akademik bir temele taşıdım.
    Konservatuvarda kontrabas üzerine çalıştım; bunun yanında yan flüt
    ve saksofon gibi farklı enstrümanlarla da ilgilendim. Sonrasında
    formasyon eğitimi alarak müzik bilgimi öğretmenlik becerileriyle
    birleştirdim.
  </p>

  <p>
    Yıllar içinde farklı gruplarla sahne aldım, çeşitli sanatçılara eşlik
    ettim; üniversite şenlikleri, mini konserler, radyo programları ve
    televizyon canlı yayınlarında müzik yaptım.
  </p>

  <p>
    Yaklaşık 10–12 yıllık öğretmenlik deneyimim var. Bugün gitar, piyano,
    bas gitar ve temel müzik eğitimi alanlarında; 5 yaşından yetişkinlere
    kadar farklı yaş gruplarına birebir dersler veriyorum.
  </p>

  <p>
    Derslerimde her öğrencinin yaşı, seviyesi, müzik zevki ve hedefi
    benim için önemlidir. Amacım yalnızca enstrüman çalmayı öğretmek değil;
    öğrencinin müziği sevmesini, özgüven kazanmasını ve düzenli şekilde
    gelişmesini sağlamaktır.
  </p>
</section>

      <section id="dersler" className="lessons reveal">
  <span className="section-badge">Dersler</span>
  <h2>Derslerimiz</h2>

  <p className="section-description">
    Gitar, piyano ve bas gitar dersleri; öğrencinin yaşı, seviyesi, müzik zevki
    ve hedeflerine göre kişiye özel olarak planlanır. Dersler yüz yüze veya
    online olarak yapılabilir.
  </p>

  <div className="lesson-list">
  <div className="lesson-card">
    <div className="lesson-icon">
      <Guitar strokeWidth={2.2} />
    </div>
    <h3>Gitar Dersi</h3>

<p>
  Gitar dersleri; yeni başlayanlar, temelini güçlendirmek isteyenler ve sevdiği
  şarkıları doğru teknikle çalmak isteyen öğrenciler için kişiye özel planlanır.
</p>

<p>
  Derslerde akor, ritim, pena kullanımı, nota bilgisi ve şarkı eşlikleri adım adım
  çalışılır. Öğrencinin müzik zevkine göre pop, rock, Türkçe şarkılar veya klasik
  gitar çalışmalarıyla ilerlenir.
</p>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
     <MessageCircle size={18} strokeWidth={2.3} />
Gitar Dersi İçin Bilgi Al
    </a>
  </div>

  <div className="lesson-card">
    <div className="lesson-icon">
      <Piano strokeWidth={2.2} />
    </div>
    <h3>Piyano Dersi</h3>

<p>
  Piyano dersleri; çocuklar, gençler ve yetişkinler için yaşa, seviyeye ve hedefe
  göre planlanır. Öğrenciye nota okuma, ritim ve temel piyano tekniği adım adım kazandırılır.
</p>

<p>
  Derslerde sağ-sol el koordinasyonu, basit parçalar, teknik egzersizler ve müzikal ifade
  çalışılır. Amaç, öğrencinin piyanoyu severek öğrenmesi ve düzenli gelişim göstermesidir.
</p>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20piyano%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
Piyano Dersi İçin Bilgi Al
    </a>
  </div>

  <div className="lesson-card">
    <div className="lesson-icon">
      <AudioWaveform strokeWidth={2.2} />
    </div>
    <h3>Bas Gitar Dersi</h3>

<p>
  Bas gitar dersleri; ritim duygusunu geliştirmek, şarkılara sağlam eşlik etmek
  ve müziğin temel yapısını daha iyi anlamak isteyen öğrenciler için planlanır.
</p>

<p>
  Derslerde parmak tekniği, ritim çalışmaları, bas yürüyüşleri, groove mantığı ve
  şarkı eşlikleri üzerinde durulur. Öğrencinin seviyesine göre pop, rock, funk ve
  farklı tarzlarda çalışmalar yapılabilir.
</p>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20bas%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
Bas Gitar Dersi İçin Bilgi Al
    </a>
  </div>
</div>
</section>

            <section id="paketler" className="packages reveal">
  <span className="section-badge">Paketler</span>
  <h2>Ders Paketleri</h2>

  <p className="section-description">
    Ders paketleri öğrencinin yaşı, seviyesi, hedefi ve haftalık çalışma düzenine göre
    kişiye özel olarak planlanır. İlk görüşmede öğrencinin ihtiyacı belirlenir ve en uygun
    ders süreci birlikte seçilir.
  </p>

  <div className="package-list">
  <div className="package-card">
    <div className="package-icon">
      <Star strokeWidth={2.2} />
    </div>
    <h3>Başlangıç Paketi</h3>

    <p>
      Gitar, piyano veya bas gitara yeni başlayacak öğrenciler için hazırlanır.
      Enstrümanı ilk kez tanıyan öğrencilerde temel duruş, ritim, nota bilgisi,
      basit egzersizler ve kolay şarkılarla güvenli bir başlangıç yapılır.
    </p>

    <p>
      Bu paket özellikle müziğe sağlam bir temel atmak, doğru alışkanlıklar kazanmak
      ve düzenli çalışmaya başlamak isteyen çocuk, genç ve yetişkin öğrenciler için uygundur.
    </p>

    <span className="package-badge">Yeni başlayanlar için ideal</span>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20Ba%C5%9Flang%C4%B1%C3%A7%20Paketi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
Başlangıç Paketi İçin Bilgi Al
    </a>
  </div>

  <div className="package-card">
    <div className="package-icon">
      <TrendingUp strokeWidth={2.2} />
    </div>
    <h3>Gelişim Paketi</h3>

    <p>
      Daha önce enstrüman çalmış veya temel bilgisi olan öğrenciler için uygundur.
      Derslerde teknik gelişim, repertuvar çalışmaları, ritim, nota okuma, müzikal ifade
      ve öğrencinin seviyesine uygun şarkılar üzerinde çalışılır.
    </p>

    <p>
      Bu paket, mevcut seviyesini ilerletmek, daha bilinçli çalışmak ve sevdiği parçaları
      daha doğru teknikle çalmak isteyen öğrenciler için kişiye özel şekilde planlanır.
    </p>

    <span className="package-badge">Birebir özel gelişim programı</span>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20Geli%C5%9Fim%20Paketi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
Gelişim Paketi İçin Bilgi Al
    </a>
  </div>

  <div className="package-card">
    <div className="package-icon">
      <Smile strokeWidth={2.2} />
    </div>
    <h3>Çocuklar İçin Müzik</h3>

    <p>
      Çocukların yaşına, dikkat süresine ve ilgisine uygun şekilde planlanan eğlenceli
      ve öğretici bir müzik sürecidir. Derslerde ritim, kulak gelişimi, basit melodiler,
      enstrüman tanıma ve müzik sevgisi ön planda tutulur.
    </p>

    <p>
      Amaç çocuğun müzikle güvenli, keyifli ve sabırlı bir şekilde tanışmasıdır.
      Dersler çocuğun hızına göre ilerler ve süreç veliyle iletişim içinde takip edilir.
    </p>

    <span className="package-badge">Çocuklara uygun keyifli dersler</span>

    <a
      href="https://wa.me/905558089585?text=Merhaba%2C%20%C3%87ocuklar%20i%C3%A7in%20m%C3%BCzik%20dersleri%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
Çocuklar İçin Bilgi Al
    </a>
  </div>
</div>
</section>

{videos.length > 0 && (
  <section id="videolar" className="videos-section">
    <div className="section-header">
      <span className="section-badge">Atölyeden Kısa Videolar</span>
      <h2>Derslerden ve Performanslardan Kısa Anlar</h2>
      <p>
        Eren Müzik Atölyesi&apos;nde derslerden, öğrenci çalışmalarından ve
        enstrüman performanslarından kısa videolar.
      </p>
    </div>

    <div className="videos-grid">
{videos.map((video) => (
  <article className="video-card" key={video.id}>
    {playingVideoId === video.id ? (
  <div className="video-player">
    <iframe
      src={`${getYoutubeEmbedUrl(video.videoUrl)}?autoplay=1`}
      title={video.title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    ></iframe>
  </div>
) : (
  <button
    type="button"
    className="video-thumbnail"
    onClick={() => setPlayingVideoId(video.id)}
    aria-label={`${video.title} videosunu oynat`}
  >
    <img
      src={video.thumbnailUrl || getYoutubeThumbnail(video.videoUrl)}
      alt={video.title}
    />
    <div className="video-thumbnail-overlay"></div>
    <div className="video-play-button">▶</div>
    <span className="video-watch-label">Videoyu oynat</span>
  </button>
)}

    <div className="video-card-content">
      {video.category && (
        <span className="video-category-badge">{video.category}</span>
      )}

      <h3>{video.title}</h3>

      {video.description && <p>{video.description}</p>}

     <button
  type="button"
  className="video-link-button"
  onClick={() =>
    setPlayingVideoId(playingVideoId === video.id ? null : video.id)
  }
>
  {playingVideoId === video.id ? "Önizlemeye Dön" : "Videoyu Oynat"}
</button>
    </div>
  </article>
))}
    </div>
  </section>
)}

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
  <span className="section-badge">SSS</span>
  <h2>Sık Sorulan Sorular</h2>

  <p className="section-description">
    Derslere başlamadan önce aklınıza takılabilecek temel soruları burada bulabilirsiniz.
    Daha detaylı bilgi almak isterseniz WhatsApp üzerinden iletişime geçebilirsiniz.
  </p>

  <div className="faq-list">
    {[
      {
        question: "Dersler kimler için uygundur?",
        answer:
          "Dersler çocuklar, gençler ve yetişkinler için uygundur. Gitar, piyano, bas gitar veya temel müzik eğitimi almak isteyen öğrenciler için seviye ve hedefe göre kişiye özel bir ders planı hazırlanır.",
      },
      {
        question: "Hiç müzik bilgim yok, yine de başlayabilir miyim?",
        answer:
          "Evet. Dersler tamamen başlangıç seviyesinden başlayacak şekilde planlanabilir. Nota bilmek, daha önce enstrüman çalmış olmak veya müzik geçmişine sahip olmak zorunlu değildir.",
      },
      {
        question: "Çocuklar kaç yaşından itibaren derse başlayabilir?",
        answer:
          "Çocuğun ilgisi, dikkat süresi ve fiziksel uygunluğu dikkate alınarak karar verilir. Daha küçük yaş gruplarında dersler oyunlaştırılmış, eğlenceli ve temel müzik sevgisini geliştirmeye yönelik ilerler.",
      },
      {
        question: "Dersler birebir mi yapılıyor?",
        answer:
          "Evet, dersler birebir olarak planlanır. Böylece öğrencinin seviyesi, öğrenme hızı, müzik zevki ve hedefleri daha yakından takip edilir.",
      },
      {
        question: "Dersler online mı, yüz yüze mi?",
        answer:
          "Dersler ihtiyaca göre yüz yüze veya online olarak yapılabilir. Online derslerde de öğrencinin seviyesi takip edilir, düzenli çalışma planı oluşturulur ve ders süreci adım adım ilerletilir.",
      },
      {
        question: "Derse başlamak için enstrümanım olmak zorunda mı?",
        answer:
          "Başlangıç aşamasında enstrüman seçimi birlikte değerlendirilebilir. Öğrencinin yaşı, hedefi ve bütçesine göre uygun enstrüman seçimi konusunda yönlendirme yapılabilir.",
      },
      {
        question: "Ne kadar sürede şarkı çalmaya başlayabilirim?",
        answer:
          "Bu süre öğrencinin yaşı, çalışma düzeni, seçilen enstrüman ve hedeflerine göre değişir. Düzenli çalışmayla başlangıç seviyesindeki öğrenciler kısa sürede basit şarkılar ve temel eşlikler çalmaya başlayabilir.",
      },
      {
        question: "Derslerde hangi tarz müzikler çalışılıyor?",
        answer:
          "Derslerde öğrencinin ilgisine göre pop, rock, Türkçe şarkılar, temel klasik çalışmalar, ritim egzersizleri, repertuvar çalışmaları ve müzik teorisi konuları işlenebilir.",
      },
    ].map((faqItem, index) => {
      const isOpen = openFaqIndex === index;

      return (
        <div
          className={`faq-item ${isOpen ? "faq-item-open" : ""}`}
          key={faqItem.question}
        >
          <button
            type="button"
            className="faq-question"
            onClick={() => toggleFaq(index)}
            aria-expanded={isOpen}
          >
            <span>{faqItem.question}</span>
            <span className="faq-icon">{isOpen ? "−" : "+"}</span>
          </button>

          <div className="faq-answer">
            <p>{faqItem.answer}</p>
          </div>
        </div>
      );
    })}
  </div>

  <div className="faq-cta">
    <p>Aklınıza takılan başka bir soru mu var?</p>

<a
  href="https://wa.me/905558089585?text=Merhaba%2C%20akl%C4%B1ma%20tak%C4%B1lan%20bir%20soru%20var.%20Bilgi%20alabilir%20miyim%3F"
  target="_blank"
  rel="noopener noreferrer"
  className="whatsapp-button"
>
  <MessageCircle size={18} strokeWidth={2.3} />
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
  <MessageCircle size={18} strokeWidth={2.3} />
  WhatsApp ile Yaz
</a>
  </div>
<div className="contact-form-intro">
  <span className="contact-form-badge">Hızlı başvuru</span>

  <h3>Sana uygun dersi birlikte belirleyelim</h3>

  <p>
    Hangi enstrümanla ilgilendiğini ve seviyeni yazman yeterli.
    Eren Müzik Atölyesi en kısa sürede sana dönüş yapar.
  </p>

  <div className="contact-trust-list">
    <span>WhatsApp veya telefonla dönüş</span>
    <span>Seviye ve hedefe göre yönlendirme</span>
    <span>Çocuklar ve yetişkinler için birebir ders</span>
  </div>
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
      <div className="mobile-bottom-cta">
        <div className="mobile-bottom-cta-text">
          <span>Ders hakkında bilgi al</span>
<small>WhatsApp’tan hemen yaz</small>

        </div>

        <a
          href="https://wa.me/905558089585?text=Merhaba%2C%20Eren%20M%C3%BCzik%20At%C3%B6lyesi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum."
          className="mobile-bottom-cta-button"
          target="_blank"
          rel="noopener noreferrer"
        >
          Yaz
        </a>
      </div>
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