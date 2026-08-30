import { useEffect, useState } from "react";
import {
  UserRound,
  Smile,
  MapPin,
  Guitar,
  Piano,
  AudioWaveform,
  MessageCircle,
  CalendarCheck,
} from "lucide-react";
import "./App.css";
import erenLogo from "./assets/eren-logo-navbar.webp";
import erenHeroLogo from "./assets/eren-logo-transparent.webp";
import { API_BASE_URL, fetchWithAdminToken } from "./services/api";
import {
  getSavedAdminToken,
  hasSavedAdminToken,
  saveAdminToken,
  clearAdminToken,
} from "./utils/adminSession";
import { buildWhatsAppLink, buildBusinessWhatsAppLink } from "./utils/whatsapp";
import { getSubmissionDate, computeSubmissionStats } from "./utils/submissionStats";
import { getYoutubeThumbnail, getYoutubeEmbedUrl } from "./utils/youtube";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
 const [playingVideoId, setPlayingVideoId] = useState(null);

  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    lesson: "",
    message: "",
    website: "", // honeypot: must stay empty; hidden from real visitors
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
const [formStatus, setFormStatus] = useState({
  type: "",
  message: "",
});

const [appointmentForm, setAppointmentForm] = useState({
  name: "",
  phone: "",
  email: "",
  lesson: "",
  appointmentDate: "",
  appointmentTime: "",
  note: "",
  website: "", // honeypot: must stay empty; hidden from real visitors
});

const [, setUnavailableAppointmentTimes] =
  useState([]);

  const [availableAppointmentTimes, setAvailableAppointmentTimes] =
  useState([]);

const [isSelectedAppointmentDayOpen, setIsSelectedAppointmentDayOpen] =
  useState(true);

const [isAppointmentAvailabilityLoading, setIsAppointmentAvailabilityLoading] =
  useState(false);

const [isAppointmentSubmitting, setIsAppointmentSubmitting] =
  useState(false);

const [appointmentFormStatus, setAppointmentFormStatus] = useState({
  type: "",
  message: "",
});

const [activeContactTab, setActiveContactTab] = useState("contact");

  const [submissions, setSubmissions] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [weeklySchedule, setWeeklySchedule] = useState([]);
const [weeklyScheduleStatus, setWeeklyScheduleStatus] = useState(null);
const [isWeeklyScheduleLoading, setIsWeeklyScheduleLoading] = useState(false);
const [updatingScheduleDay, setUpdatingScheduleDay] = useState(null);

const [blockedSlotForm, setBlockedSlotForm] = useState({
  date: "",
  startTime: "",
  endTime: "",
  reason: "",
});

const [blockedSlotStatus, setBlockedSlotStatus] = useState(null);

const [isBlockedSlotSubmitting, setIsBlockedSlotSubmitting] =
  useState(false);
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
  hasSavedAdminToken()
);
  const [adminToken, setAdminToken] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lessonFilter, setLessonFilter] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  const [activeAdminSection, setActiveAdminSection] = useState("dashboard");
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);

  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  useEffect(() => {
  if (!videoFormStatus) return;

  const statusTimer = setTimeout(() => {
    setVideoFormStatus(null);
  }, 3500);

  return () => clearTimeout(statusTimer);
}, [videoFormStatus]);

const toggleFaq = (index) => {
  setOpenFaqIndex((currentIndex) => (currentIndex === index ? null : index));
};

const handleAdminSectionChange = (section) => {
  setActiveAdminSection(section);
  setIsAdminMenuOpen(false);
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

  const adminSectionInfo = {
  dashboard: {
    eyebrow: "Genel Bakış",
    title: "Ana Panel",
    description:
      "Başvuruların ve içeriklerin genel durumunu buradan takip edebilirsin.",
  },
  submissions: {
    eyebrow: "Başvuru Yönetimi",
    title: "Gelen Başvurular",
    description:
      "Form üzerinden gelen öğrenci başvurularını buradan takip edebilirsin.",
  },
    appointments: {
  eyebrow: "Ön Görüşme Yönetimi",
  title: "Ön Görüşmeler",
  description:
    "Öğrenci adaylarının oluşturduğu ön görüşme taleplerini buradan takip edebilirsin.",
},
  blockedSlots: {
  eyebrow: "Takvim Yönetimi",
  title: "Kapalı Saatler",
  description:
  "Ön görüşme planlanmasını istemediğin gün ve saat aralıklarını buradan yönetebilirsin.",
},
weeklySchedule: {
  eyebrow: "Takvim Yönetimi",
  title: "Haftalık Görüşme Saatleri",
  description:
    "Haftanın hangi günlerinde ve hangi saatler arasında ön görüşme planlanabileceğini buradan ayarlayabilirsin.",
},
  videos: {
    eyebrow: "Video Galeri",
    title: "Video Yönetimi",
    description:
      "Atölye videolarını buradan ekleyebilir, düzenleyebilir ve silebilirsin.",
  },
};

const currentAdminSectionInfo =
  adminSectionInfo[activeAdminSection] || adminSectionInfo.dashboard;


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
    const response = await fetch(`${API_BASE_URL}/api/contact`, {
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

useEffect(() => {
  const selectedDate = appointmentForm.appointmentDate;

  if (!selectedDate) {
    // Resetting availability UI state synchronously when the date is
    // cleared is intentional — it must happen immediately, in the same
    // effect that would otherwise start fetching availability for a date.
    // Restructuring this into derived-state-during-render would change
    // when/whether these resets are visible, so it is deliberately left
    // as-is rather than "fixed" at the risk of changing behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailableAppointmentTimes([]);
    setUnavailableAppointmentTimes([]);
    setIsSelectedAppointmentDayOpen(true);
    setIsAppointmentAvailabilityLoading(false);

    setAppointmentForm((currentForm) => ({
      ...currentForm,
      appointmentTime: "",
    }));

    return;
  }

  const fetchAppointmentAvailability = async () => {
    setIsAppointmentAvailabilityLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/appointments/availability?date=${encodeURIComponent(
          selectedDate
        )}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Ön görüşme saatleri alınamadı"
        );
      }

      const availableTimes = Array.isArray(data.availableTimes)
        ? data.availableTimes
        : [];

      const unavailableTimes = Array.isArray(data.unavailableTimes)
        ? data.unavailableTimes
        : [];

      setAvailableAppointmentTimes(availableTimes);
      setUnavailableAppointmentTimes(unavailableTimes);
      setIsSelectedAppointmentDayOpen(data.isOpen !== false);

      setAppointmentForm((currentForm) =>
        availableTimes.includes(currentForm.appointmentTime)
          ? currentForm
          : {
              ...currentForm,
              appointmentTime: "",
            }
      );
    } catch (error) {
      console.error("Ön görüşme saatleri alınamadı:", error);

      setAvailableAppointmentTimes([]);
      setUnavailableAppointmentTimes([]);
      setIsSelectedAppointmentDayOpen(true);

      setAppointmentForm((currentForm) => ({
        ...currentForm,
        appointmentTime: "",
      }));
    } finally {
      setIsAppointmentAvailabilityLoading(false);
    }
  };

  fetchAppointmentAvailability();
}, [appointmentForm.appointmentDate]);

const handleAppointmentSubmit = async (e) => {
  e.preventDefault();

  if (isAppointmentSubmitting) return;

  setIsAppointmentSubmitting(true);
  setAppointmentFormStatus({
    type: "",
    message: "",
  });

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(appointmentForm),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Ön görüşme oluşturulamadı");
    }

    setAppointmentFormStatus({
      type: "success",
      message:
  "Ön görüşme talebiniz başarıyla alındı. Onay için sizinle iletişime geçeceğiz.",
    });

    setAppointmentForm({
      name: "",
      phone: "",
      email: "",
      lesson: "",
      appointmentDate: "",
      appointmentTime: "",
      note: "",
    });

    setTimeout(() => {
      setAppointmentFormStatus({
        type: "",
        message: "",
      });
    }, 6000);
  } catch (error) {
    console.error("Ön görüşme gönderilirken hata oluştu:", error);

    setAppointmentFormStatus({
      type: "error",
      message:
        error.message ||
        "Ön görüşme gönderilirken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  } finally {
    setIsAppointmentSubmitting(false);
  }
};

const fetchSubmissions = async (token = adminToken) => {
  try {
    const { ok, data } = await fetchWithAdminToken("/api/submissions", token);

    if (ok) {
      setSubmissions(Array.isArray(data) ? data : []);
    } else {
      alert(data.message || "Başvurular alınamadı");
    }
  } catch (error) {
    console.error("Başvurular alınamadı:", error);
    alert("Başvurular alınırken bir hata oluştu");
  }
};

const fetchAppointments = async (token = adminToken) => {
  try {
    const { ok, data } = await fetchWithAdminToken("/api/admin/appointments", token);

    if (ok) {
      setAppointments(Array.isArray(data) ? data : []);
    } else {
      alert(data.message || "Ön görüşmeler alınamadı");
    }
  } catch (error) {
    console.error("Ön görüşmeler alınamadı:", error);
    alert("Ön görüşmeler alınırken bir hata oluştu");
  }
};

const fetchBlockedSlots = async (token = adminToken) => {
  try {
    const { ok, data } = await fetchWithAdminToken("/api/admin/blocked-slots", token);

    if (ok) {
      setBlockedSlots(
        Array.isArray(data.blockedSlots) ? data.blockedSlots : []
      );
    } else {
      alert(data.message || "Kapalı saatler alınamadı");
    }
  } catch (error) {
    console.error("Kapalı saatler alınamadı:", error);
    alert("Kapalı saatler alınırken bir hata oluştu");
  }
};

const fetchWeeklySchedule = async (token = adminToken) => {
  setIsWeeklyScheduleLoading(true);

  try {
    const { ok, data } = await fetchWithAdminToken("/api/admin/weekly-schedule", token);

    if (ok) {
      setWeeklySchedule(
        Array.isArray(data.schedules) ? data.schedules : []
      );
    } else {
      setWeeklyScheduleStatus({
        type: "error",
        message: data.message || "Haftalık program alınamadı",
      });
    }
  } catch (error) {
    console.error("Haftalık program alınamadı:", error);

    setWeeklyScheduleStatus({
      type: "error",
      message: "Haftalık program alınırken bir hata oluştu",
    });
  } finally {
    setIsWeeklyScheduleLoading(false);
  }
};

const handleWeeklyScheduleChange = (dayOfWeek, field, value) => {
  setWeeklySchedule((currentSchedule) =>
    currentSchedule.map((day) =>
      day.dayOfWeek === dayOfWeek
        ? {
            ...day,
            [field]: value,
          }
        : day
    )
  );
};

const handleSaveWeeklySchedule = async (day) => {
  setUpdatingScheduleDay(day.dayOfWeek);
  setWeeklyScheduleStatus(null);

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/weekly-schedule/${day.dayOfWeek}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          isOpen: Boolean(day.isOpen),
          startTime: day.startTime,
          endTime: day.endTime,
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      setWeeklySchedule((currentSchedule) =>
        currentSchedule.map((scheduleDay) =>
          scheduleDay.dayOfWeek === data.schedule.dayOfWeek
            ? data.schedule
            : scheduleDay
        )
      );

      setWeeklyScheduleStatus({
        type: "success",
        message: "Çalışma programı başarıyla güncellendi.",
      });
    } else {
      setWeeklyScheduleStatus({
        type: "error",
        message: data.message || "Çalışma programı güncellenemedi.",
      });
    }
  } catch (error) {
    console.error("Çalışma programı güncellenemedi:", error);

    setWeeklyScheduleStatus({
      type: "error",
      message: "Çalışma programı güncellenirken bir hata oluştu.",
    });
  } finally {
    setUpdatingScheduleDay(null);
  }
};

const fetchAdminVideos = async (token = adminToken) => {
  try {
    const { ok, data } = await fetchWithAdminToken("/api/admin/videos", token);

    if (!ok) {
      throw new Error("Videolar alınamadı");
    }

    setAdminVideos(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("Admin videoları alınırken hata:", error);
  }
};

useEffect(() => {
  const savedToken = getSavedAdminToken();

  if (savedToken) {
    // Restoring a saved admin session on mount is intentional and must run
    // exactly once — see the deliberately-empty deps array below (adding
    // the fetch* functions, none of which are memoized, would make this
    // effect re-run on every render instead of once on mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdminToken(savedToken);
    setIsAdminLoggedIn(true);
    fetchSubmissions(savedToken);
    fetchAdminVideos(savedToken);
    fetchAppointments(savedToken);
    fetchBlockedSlots(savedToken);
    fetchWeeklySchedule(savedToken);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

const handleBlockedSlotFormChange = (e) => {
  const { name, value } = e.target;

  setBlockedSlotForm((prevForm) => ({
    ...prevForm,
    [name]: value,
  }));
};

const handleBlockedSlotSubmit = async (e) => {
  e.preventDefault();

  if (
    !blockedSlotForm.date ||
    !blockedSlotForm.startTime ||
    !blockedSlotForm.endTime
  ) {
    setBlockedSlotStatus({
      type: "error",
      message: "Tarih, başlangıç saati ve bitiş saati gereklidir.",
    });
    return;
  }

  if (blockedSlotForm.startTime >= blockedSlotForm.endTime) {
    setBlockedSlotStatus({
      type: "error",
      message: "Bitiş saati, başlangıç saatinden sonra olmalıdır.",
    });
    return;
  }

  setIsBlockedSlotSubmitting(true);
  setBlockedSlotStatus(null);

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/blocked-slots`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(blockedSlotForm),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Kapalı saat eklenemedi.");
    }

    setBlockedSlotStatus({
      type: "success",
      message: data.message || "Kapalı saat başarıyla eklendi.",
    });

    setBlockedSlotForm({
      date: "",
      startTime: "",
      endTime: "",
      reason: "",
    });

    await fetchBlockedSlots(adminToken);
  } catch (error) {
    console.error("Kapalı saat eklenemedi:", error);

    setBlockedSlotStatus({
      type: "error",
      message: error.message || "Kapalı saat eklenirken bir hata oluştu.",
    });
  } finally {
    setIsBlockedSlotSubmitting(false);
  }
};

const handleDeleteBlockedSlot = async (id) => {
  const isConfirmed = window.confirm(
    "Bu kapalı saat kaydını silmek istediğine emin misin?"
  );

  if (!isConfirmed) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/blocked-slots/${id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Kapalı saat silinemedi.");
    }

    setBlockedSlotStatus({
      type: "success",
      message: data.message || "Kapalı saat başarıyla silindi.",
    });

    await fetchBlockedSlots(adminToken);
  } catch (error) {
    console.error("Kapalı saat silinemedi:", error);

    setBlockedSlotStatus({
      type: "error",
      message: error.message || "Kapalı saat silinirken bir hata oluştu.",
    });
  }
};

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
  `${API_BASE_URL}/api/submissions/${id}/status`,
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

const handleAppointmentStatusChange = async (id, newStatus) => {
  if (!adminToken) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/appointments/${id}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      }
    );

    const data = await response.json();

   if (!response.ok) {
  alert(data.message || "Ön görüşme durumu güncellenemedi");
  return;
}

    setAppointments((previousAppointments) =>
      previousAppointments.map((appointment) =>
        appointment._id === id
          ? {
              ...appointment,
              status: data.appointment?.status || newStatus,
            }
          : appointment
      )
    );
  } catch (error) {
  console.error("Ön görüşme durumu güncelleme hatası:", error);
  alert("Ön görüşme durumu güncellenirken bir hata oluştu");
}
};

const handleDeleteAppointment = async (id) => {
  const confirmDelete = window.confirm(
    "Bu ön görüşmeyi kalıcı olarak silmek istediğine emin misin?"
  );

  if (!confirmDelete || !adminToken) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/appointments/${id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      alert(data.message || "Ön görüşme silinemedi");
      return;
    }

    setAppointments((previousAppointments) =>
      previousAppointments.filter(
        (appointment) => appointment._id !== id
      )
    );
  } catch (error) {
    console.error("Ön görüşme silme hatası:", error);
    alert("Ön görüşme silinirken bir hata oluştu");
  }
};

const handleDeleteSubmission = async (id) => {
  const confirmDelete = window.confirm("Bu başvuruyu silmek istiyor musun?");

  if (!confirmDelete) return;

  try {
const response = await fetch(
  `${API_BASE_URL}/api/submissions/${id}`,
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
      `${API_BASE_URL}/api/admin/login`,
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
  saveAdminToken(data.token);
  setAdminToken(data.token);
  setIsAdminLoggedIn(true);
  fetchSubmissions(data.token);
  fetchAppointments(data.token);
  fetchBlockedSlots(data.token);
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
    clearAdminToken();
  setIsAdminLoggedIn(false);
  setAdminToken("");
  setAdminPassword("");
  setSearchTerm("");
  setLessonFilter("");
  setSelectedSubmission(null);
  setSubmissions([]);
};

  useEffect(() => {
     // Standard fetch-on-mount pattern: fetchVideos sets state only inside
     // its own async fetch callback, not synchronously here — flagged by
     // this lint rule's static heuristic regardless.
     // eslint-disable-next-line react-hooks/set-state-in-effect
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
  <div className="admin-mobile-topbar">
    <div className="admin-mobile-brand">
      <strong>Eren Müzik Atölyesi</strong>
      <span>Yönetim Paneli</span>
    </div>

    <button
      type="button"
      className="admin-menu-toggle"
      onClick={() => setIsAdminMenuOpen((current) => !current)}
      aria-expanded={isAdminMenuOpen}
      aria-label="Admin menüsünü aç veya kapat"
    >
      {isAdminMenuOpen ? "✕" : "☰"}
    </button>
  </div>

  <nav
    className={`admin-section-nav ${
      isAdminMenuOpen ? "admin-section-nav-open" : ""
    }`}
  >
    <button
      type="button"
      className={
        activeAdminSection === "dashboard"
          ? "admin-section-button active"
          : "admin-section-button"
      }
      onClick={() => handleAdminSectionChange("dashboard")}
    >
      Ana Panel
    </button>

    <button
      type="button"
      className={
        activeAdminSection === "submissions"
          ? "admin-section-button active"
          : "admin-section-button"
      }
      onClick={() => handleAdminSectionChange("submissions")}
    >
      Başvurular
    </button>

    <button
  type="button"
  className={
    activeAdminSection === "appointments"
      ? "admin-section-button active"
      : "admin-section-button"
  }
  onClick={() => handleAdminSectionChange("appointments")}
>
  Ön Görüşmeler
</button>
<button
  type="button"
  className={
    activeAdminSection === "blockedSlots"
      ? "admin-section-button active"
      : "admin-section-button"
  }
  onClick={() => handleAdminSectionChange("blockedSlots")}
>
  Kapalı Saatler
</button>
<button
  type="button"
  className={
    activeAdminSection === "weeklySchedule"
      ? "admin-section-button active"
      : "admin-section-button"
  }
  onClick={() => handleAdminSectionChange("weeklySchedule")}
>
  Çalışma Saatleri
</button>
    <button
      type="button"
      className={
        activeAdminSection === "videos"
          ? "admin-section-button active"
          : "admin-section-button"
      }
      onClick={() => handleAdminSectionChange("videos")}
    >
      Video Yönetimi
    </button>
  </nav>

<div className="admin-dashboard-header">
  <div>
    <p className="admin-eyebrow">
      {currentAdminSectionInfo.eyebrow}
    </p>

    <h1>{currentAdminSectionInfo.title}</h1>

    <p>{currentAdminSectionInfo.description}</p>
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

      {activeAdminSection === "dashboard" && (
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
)}

{activeAdminSection === "weeklySchedule" && (
  <div className="admin-video-management">
    {weeklyScheduleStatus && (
      <p className="admin-video-status">
        {weeklyScheduleStatus.message}
      </p>
    )}

    <div className="admin-video-form-heading">
      <h3>Haftalık Ön Görüşme Programı</h3>

<p>
  Öğrenci adaylarının hangi günlerde ve hangi saatler arasında ön görüşme
  planlayabileceğini belirleyebilirsin.
</p>
    </div>

    {isWeeklyScheduleLoading ? (
      <p>Çalışma programı yükleniyor...</p>
    ) : (
      <div className="weekly-schedule-list">
        {weeklySchedule.map((day) => (
          <div
            key={day.dayOfWeek}
            className="weekly-schedule-card"
          >
            <div className="weekly-schedule-day">
              <strong>
                {
                  [
                    "Pazar",
                    "Pazartesi",
                    "Salı",
                    "Çarşamba",
                    "Perşembe",
                    "Cuma",
                    "Cumartesi",
                  ][day.dayOfWeek]
                }
              </strong>

              <label className="admin-video-checkbox">
                <input
                  type="checkbox"
                  checked={day.isOpen}
                  onChange={(event) =>
                    handleWeeklyScheduleChange(
                      day.dayOfWeek,
                      "isOpen",
                      event.target.checked
                    )
                  }
                />

                <span>
                  {day.isOpen ? "Ön Görüşmeye Açık" : "Kapalı"}
                </span>
              </label>
            </div>

            <div className="weekly-schedule-times">
              <label>
                Başlangıç Saati

                <input
                  type="time"
                  value={day.startTime}
                  disabled={!day.isOpen}
                  onChange={(event) =>
                    handleWeeklyScheduleChange(
                      day.dayOfWeek,
                      "startTime",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Bitiş Saati

                <input
                  type="time"
                  value={day.endTime}
                  disabled={!day.isOpen}
                  onChange={(event) =>
                    handleWeeklyScheduleChange(
                      day.dayOfWeek,
                      "endTime",
                      event.target.value
                    )
                  }
                />
              </label>
            </div>

            <button
              type="button"
              className="admin-video-submit-button"
              disabled={updatingScheduleDay === day.dayOfWeek}
              onClick={() => handleSaveWeeklySchedule(day)}
            >
              {updatingScheduleDay === day.dayOfWeek
                ? "Kaydediliyor..."
                : "Günü Kaydet"}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)}

    {activeAdminSection === "videos" && (
  <div className="admin-video-management">
  
{videoFormStatus && (
  <p className="admin-video-status">
    {videoFormStatus}
  </p>
)}

<div className="admin-video-form-heading">
  <h3>
    {editingVideoId ? "Videoyu Düzenle" : "Yeni Video Ekle"}
  </h3>

  <p>
    {editingVideoId
      ? "Seçtiğin videonun bilgilerini güncelleyip yeniden kaydedebilirsin."
      : "YouTube veya YouTube Shorts bağlantısını kullanarak galeriye yeni video ekleyebilirsin."}
  </p>
</div>
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
  placeholder="YouTube veya Shorts bağlantısını buraya yapıştır"
  value={videoForm.videoUrl}
  onChange={handleVideoFormChange}
/>

 <input
  type="text"
  name="category"
 placeholder="Kategori: Gitar, Piyano veya Performans"
  value={videoForm.category}
  onChange={handleVideoFormChange}
/>

<input
  type="number"
  name="order"
  min="0"
  placeholder="Gösterim sırası: 0 en üstte"
  value={videoForm.order}
  onChange={handleVideoFormChange}
/>
<input
  type="text"
  name="thumbnailUrl"
 placeholder="Özel kapak görseli bağlantısı — isteğe bağlı"
  value={videoForm.thumbnailUrl}
  onChange={handleVideoFormChange}
/>

    <textarea
  name="description"
  placeholder="Videoda ne olduğunu kısaca anlat"
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

    <div className="admin-video-form-actions">
  <button type="submit" disabled={isVideoSubmitting}>
    {isVideoSubmitting
      ? "Kaydediliyor..."
      : editingVideoId
        ? "Değişiklikleri Güncelle"
        : "Video Kaydet"}
  </button>

  {editingVideoId && (
    <button
      type="button"
      className="admin-video-cancel-button"
      onClick={resetVideoForm}
      disabled={isVideoSubmitting}
    >
      Düzenlemeyi İptal Et
    </button>
  )}
</div>
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
)}

{activeAdminSection === "blockedSlots" && (
  <div className="admin-video-management">
    {blockedSlotStatus && (
      <p className="admin-video-status">
        {blockedSlotStatus.message}
      </p>
    )}

    <div className="admin-video-form-heading">
      <h3>Yeni Kapalı Saat Ekle</h3>

      <p>
      Öğrenci adaylarının ön görüşme planlayamayacağı tarih ve saat
aralığını belirleyebilirsin..
      </p>
    </div>

    <form
      className="admin-video-form"
      onSubmit={handleBlockedSlotSubmit}
    >
      <label>
        Tarih
        <input
          type="date"
          name="date"
          value={blockedSlotForm.date}
          onChange={handleBlockedSlotFormChange}
          required
        />
      </label>

      <label>
        Başlangıç saati
        <input
          type="time"
          name="startTime"
          step="1800"
          value={blockedSlotForm.startTime}
          onChange={handleBlockedSlotFormChange}
          required
        />
      </label>

      <label>
        Bitiş saati
        <input
          type="time"
          name="endTime"
          step="1800"
          value={blockedSlotForm.endTime}
          onChange={handleBlockedSlotFormChange}
          required
        />
      </label>

      <label>
        Açıklama
        <input
          type="text"
          name="reason"
          placeholder="Örneğin: Özel program, tatil veya ders"
          value={blockedSlotForm.reason}
          onChange={handleBlockedSlotFormChange}
        />
      </label>

      <button
        type="submit"
        disabled={isBlockedSlotSubmitting}
      >
        {isBlockedSlotSubmitting
          ? "Ekleniyor..."
          : "Kapalı Saat Ekle"}
      </button>
    </form>

    <div className="admin-video-list">
      <h3>Kayıtlı Kapalı Saatler</h3>

      {blockedSlots.length === 0 ? (
        <p className="admin-empty-text">
          Henüz kapalı saat eklenmedi.
        </p>
      ) : (
        blockedSlots.map((blockedSlot) => (
          <div
            key={blockedSlot._id || blockedSlot.id}
            className="admin-video-item"
          >
            <div>
              <strong>
                {blockedSlot.date} | {blockedSlot.startTime} –{" "}
                {blockedSlot.endTime}
              </strong>

              <p>
                {blockedSlot.reason || "Açıklama belirtilmedi"}
              </p>
            </div>

            <div className="admin-video-actions">
              <button
                type="button"
                className="admin-video-delete-button"
                onClick={() =>
                  handleDeleteBlockedSlot(
                    blockedSlot._id || blockedSlot.id
                  )
                }
              >
                Sil
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
)}

{activeAdminSection === "appointments" && (
  <>
    {appointments.length === 0 ? (
      <div className="admin-empty">
        Henüz ön görüşme bulunmuyor.
      </div>
    ) : (
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ad Soyad</th>
              <th>Telefon</th>
              <th>E-posta</th>
              <th>İlgilenilen Ders</th>
              <th>Görüşme Tarihi</th>
              <th>Saat</th>
              <th>Not</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>

          <tbody>
            {appointments.map((appointment) => (
              <tr key={appointment._id}>
                <td>{appointment.name}</td>

                <td>
                  <a href={`tel:${appointment.phone}`}>
                    {appointment.phone}
                  </a>
                </td>

                <td>{appointment.email || "-"}</td>

                <td>{appointment.lesson}</td>

                <td>{appointment.appointmentDate}</td>

                <td>{appointment.appointmentTime}</td>

                <td>{appointment.note || "-"}</td>

                <td>
  <select
    className="admin-status-select"
    value={appointment.status || "Beklemede"}
    onChange={(e) =>
      handleAppointmentStatusChange(
        appointment._id,
        e.target.value
      )
    }
  >
    <option value="Beklemede">Beklemede</option>
    <option value="Onaylandı">Onaylandı</option>
    <option value="Tamamlandı">Tamamlandı</option>
    <option value="İptal">İptal</option>
  </select>
</td>
<td>
  <button
    type="button"
    className="admin-delete-button"
    onClick={() => handleDeleteAppointment(appointment._id)}
  >
    Sil
  </button>
</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
)}

{activeAdminSection === "submissions" && (
  <>
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
        </>
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
  <div className="navbar-logo">
  <img
    src={erenLogo}
    alt="Eren Müzik Atölyesi Logo"
    className="site-logo"
  />
</div>

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
  href={buildBusinessWhatsAppLink("Merhaba, Eren Müzik Atölyesi hakkında bilgi almak istiyorum.")}
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


  <div className="hero-buttons">
  <a href="#iletisim" className="hero-button">
    <CalendarCheck size={18} strokeWidth={2.3} />
    Ücretsiz Ön Görüşme Al
  </a>

  <a
    href={buildBusinessWhatsAppLink("Merhaba, müzik dersleri hakkında bilgi almak istiyorum.")}
    target="_blank"
    rel="noopener noreferrer"
    className="whatsapp-button"
  >
    <MessageCircle size={18} strokeWidth={2.3} />
    WhatsApp’tan Hızlı Bilgi Al
  </a>
</div>
  </div>

  <div className="hero-image hero-logo-card">
  <img
    src={erenHeroLogo}
    alt="Eren Özüşen Müzik Öğretmeni"
    className="hero-main-logo"
  />
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
    ve hedeflerine göre kişiye özel olarak planlanır. İlk derste seviye analizi
    yapılır, ardından öğrenciye uygun bir çalışma yolu oluşturulur.
  </p>

  <div className="lesson-list">
    <div className="lesson-card">
      <div className="lesson-icon">
        <Guitar strokeWidth={2.2} />
      </div>

      <span className="lesson-tag">Yeni başlayanlar için uygun</span>
      <h3>Gitar Dersi</h3>

      <p>
        Gitar dersleri; sıfırdan başlamak isteyenler, temelini güçlendirmek isteyenler
        ve sevdiği şarkıları doğru teknikle çalmak isteyen öğrenciler için kişiye özel
        planlanır.
      </p>

      <p>
        Derslerde akor geçişleri, ritim, pena kullanımı, nota bilgisi ve şarkı eşlikleri
        adım adım çalışılır. Öğrencinin müzik zevkine göre pop, rock, Türkçe şarkılar
        veya klasik gitar çalışmalarıyla ilerlenir.
      </p>

      <div className="lesson-highlight">
        İlk dersten itibaren doğru tutuş, temel ritim ve sevilen şarkılar üzerinden
        sağlam bir başlangıç hedeflenir.
      </div>

      <a
        href={buildBusinessWhatsAppLink("Merhaba, gitar dersi hakkında bilgi almak istiyorum.")}
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

      <span className="lesson-tag">Çocuk, genç ve yetişkinler için</span>
      <h3>Piyano Dersi</h3>

      <p>
        Piyano dersleri; çocuklar, gençler ve yetişkinler için yaşa, seviyeye ve hedefe
        göre planlanır. Öğrenciye nota okuma, ritim ve temel piyano tekniği düzenli
        bir sistemle kazandırılır.
      </p>

      <p>
        Derslerde sağ-sol el koordinasyonu, basit parçalar, teknik egzersizler ve
        müzikal ifade çalışılır. Amaç, öğrencinin piyanoyu severek öğrenmesi ve her
        hafta ölçülebilir gelişim göstermesidir.
      </p>

      <div className="lesson-highlight">
        Nota, ritim ve el koordinasyonu birlikte gelişir; öğrenci kendi seviyesine
        uygun parçalarla motive şekilde ilerler.
      </div>

      <a
        href={buildBusinessWhatsAppLink("Merhaba, piyano dersi hakkında bilgi almak istiyorum.")}
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

      <span className="lesson-tag">Ritim ve groove odaklı</span>
      <h3>Bas Gitar Dersi</h3>

      <p>
        Bas gitar dersleri; ritim duygusunu geliştirmek, şarkılara sağlam eşlik etmek
        ve müziğin temel yapısını daha iyi anlamak isteyen öğrenciler için planlanır.
      </p>

      <p>
        Derslerde parmak tekniği, ritim çalışmaları, bas yürüyüşleri, groove mantığı
        ve şarkı eşlikleri üzerinde durulur. Öğrencinin seviyesine göre pop, rock,
        funk ve farklı tarzlarda çalışmalar yapılabilir.
      </p>

      <div className="lesson-highlight">
        Öğrenci sadece nota basmayı değil, şarkının ritmik temelini hissetmeyi ve
        güçlü eşlik etmeyi öğrenir.
      </div>

      <a
        href={buildBusinessWhatsAppLink("Merhaba, bas gitar dersi hakkında bilgi almak istiyorum.")}
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



<section id="videolar" className="videos-section">
  <div className="section-header">
    <span className="section-badge">Atölyeden Gerçek Anlar</span>

    <h2>Gerçek Ders ve Performans Kesitleri</h2>

    <p>
      Eren Müzik Atölyesi’nde derslerden, öğrenci çalışmalarından ve kısa
      performanslardan seçilmiş videolar. Ders ortamını ve öğrencilerin gelişim
      sürecini yakından görebilirsiniz.
    </p>
  </div>

  {videos.length === 0 ? (
    <p className="video-empty-message">
      Videolar şu anda yüklenemedi. Lütfen daha sonra tekrar kontrol edin.
    </p>
  ) : (
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
  )}
</section>

<section id="yorumlar" className="testimonials reveal">
  <div className="section-header">
    <span className="section-badge">Öğrenci Deneyimleri</span>
    <h2>Ders Sürecinde Neler Kazanılır?</h2>
    <p>
      Eren Müzik Atölyesi’nde amaç sadece enstrüman çalmak değil; öğrencinin
      düzenli gelişmesi, özgüven kazanması ve müziği keyifle sürdürmesidir.
    </p>
  </div>

  <div className="testimonial-list">
    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Gitar derslerinde kısa sürede temel akorları ve ritimleri daha doğru
        çalmaya başladım. Dersler anlaşılır, motive edici ve seviyeme uygun ilerliyor.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">G</div>
        <div>
          <h4>Gitar Öğrencisi</h4>
          <span>Başlangıç seviyesi</span>
        </div>
      </div>
    </div>

    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Çocuğum derslere severek katılıyor. Derslerde hem müzik sevgisi gelişiyor
        hem de dikkat, ritim ve özgüven konusunda ilerleme görüyoruz.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">V</div>
        <div>
          <h4>Veli Yorumu</h4>
          <span>Çocuklar için müzik</span>
        </div>
      </div>
    </div>

    <div className="testimonial-card">
      <div className="quote-icon">“</div>
      <p>
        Piyano derslerinde nota okuma, el koordinasyonu ve parça çalışma süreci
        adım adım ilerliyor. Her derste neye çalışmam gerektiğini net biliyorum.
      </p>
      <div className="testimonial-author">
        <div className="author-avatar">P</div>
        <div>
          <h4>Piyano Öğrencisi</h4>
          <span>Düzenli gelişim</span>
        </div>
      </div>
    </div>
  </div>

  <div className="testimonial-trust-box">
    <span>Güven notu</span>
    <p>
      Bu alan öğrenci deneyimini göstermek için hazırlanmıştır. Gerçek öğrenci
      yorumları, video referanslar ve veli geri bildirimleri geldikçe düzenli olarak
      güncellenebilir.
    </p>
  </div>
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
  href={buildBusinessWhatsAppLink("Merhaba, aklıma takılan bir soru var. Bilgi alabilir miyim?")}
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
  <span className="section-badge">İletişim</span>
  <h2>İlk Görüşme ve Başvuru</h2>

  <p>
  Dersler hakkında bilgi almak, seviyeni paylaşmak veya sana en uygun ders sürecini
  birlikte belirlemek için formu doldurabilir ya da WhatsApp’tan hemen yazabilirsin.
</p>

<p className="contact-trust-text">
  Başvurunuzdan sonra en kısa sürede sizinle iletişime geçerek seviyenize,
  hedefinize ve uygun zamanlarınıza göre ders planını birlikte netleştiriyoruz.
</p>

  <div className="contact-buttons">
    <a
      href={buildBusinessWhatsAppLink("Merhaba, dersler hakkında bilgi almak istiyorum.")}
      target="_blank"
      rel="noopener noreferrer"
      className="contact-button"
    >
      <MessageCircle size={18} strokeWidth={2.3} />
      WhatsApp ile Yaz
    </a>
  </div>

  <div className="contact-flow">
    <div className="contact-flow-step">
      <span>1</span>
      <h3>Formu gönder veya WhatsApp’tan yaz</h3>
      <p>Hangi enstrümanla ilgilendiğini ve seviyeni kısaca paylaşman yeterli.</p>
    </div>

    <div className="contact-flow-step">
      <span>2</span>
      <h3>Seviye ve hedef konuşulur</h3>
      <p>Yeni başlayan, geliştirmek isteyen veya çocuk öğrenci için ihtiyaç belirlenir.</p>
    </div>

    <div className="contact-flow-step">
      <span>3</span>
      <h3>Uygun ders planı önerilir</h3>
      <p>Öğrenciye göre ders, paket ve çalışma düzeni birlikte netleştirilir.</p>
    </div>

    <div className="contact-flow-step">
      <span>4</span>
      <h3>İlk ders planlanır</h3>
      <p>Uygun gün ve saat belirlenerek ders süreci başlatılır.</p>
    </div>
  </div>

  <div className="contact-tabs">
  <button
    type="button"
    className={activeContactTab === "contact" ? "active" : ""}
    onClick={() => setActiveContactTab("contact")}
  >
    Bilgi Al
  </button>

  <button
    type="button"
    className={activeContactTab === "appointment" ? "active" : ""}
    onClick={() => setActiveContactTab("appointment")}
  >
    Ön Görüşme Planla
  </button>
</div>

{activeContactTab === "contact" && (
  <>

    <div className="contact-form-intro">
    <span className="contact-form-badge">Hızlı başvuru</span>

    <h3>Sana uygun dersi birlikte belirleyelim</h3>

    <p>
      Hangi enstrümanla ilgilendiğini, seviyeni ve hedefini yazman yeterli.
      Eren Müzik Atölyesi en kısa sürede sana dönüş yapar.
    </p>

    <div className="contact-trust-list">
      <span>WhatsApp veya telefonla dönüş</span>
      <span>Seviye ve hedefe göre yönlendirme</span>
      <span>Çocuklar ve yetişkinler için birebir ders</span>
    </div>
  </div>

  <form className="contact-form" onSubmit={handleContactSubmit}>
    {/* Honeypot: hidden from real visitors, some bots fill it anyway. */}
    <input
      type="text"
      name="website"
      value={contactForm.website}
      onChange={(e) =>
        setContactForm({ ...contactForm, website: e.target.value })
      }
      tabIndex="-1"
      autoComplete="off"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-9999px",
        width: "1px",
        height: "1px",
        opacity: 0,
        overflow: "hidden",
      }}
    />
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
      <option value="Çocuklar İçin Müzik">Çocuklar İçin Müzik</option>
    </select>

    <textarea
      placeholder="Kısaca seviyeni, hedefini veya uygun olduğun günleri yazabilirsin."
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
    </>
)}
{activeContactTab === "appointment" && (
  <div className="appointment-area">
  <div className="appointment-intro">
    <span className="contact-form-badge">Ücretsiz Ön Görüşme</span>

<h3>Ön görüşme için gün ve saat seç</h3>

<p>
  İlgilendiğin ders türünü, tarihi ve saati seçerek ön görüşme talebini
  oluşturabilirsin. Talebin onaylandıktan sonra seninle iletişime
  geçilecektir.
</p>
  </div>

  <form
    className="appointment-form"
    onSubmit={handleAppointmentSubmit}
  >
    {/* Honeypot: hidden from real visitors, some bots fill it anyway. */}
    <input
      type="text"
      name="website"
      value={appointmentForm.website}
      onChange={(e) =>
        setAppointmentForm({ ...appointmentForm, website: e.target.value })
      }
      tabIndex="-1"
      autoComplete="off"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-9999px",
        width: "1px",
        height: "1px",
        opacity: 0,
        overflow: "hidden",
      }}
    />
    <input
      type="text"
      placeholder="Ad Soyad"
      value={appointmentForm.name}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          name: e.target.value,
        })
      }
      required
    />

    <input
      type="tel"
      placeholder="Telefon"
      value={appointmentForm.phone}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          phone: e.target.value,
        })
      }
      required
    />

    <input
      type="email"
      placeholder="E-posta"
      value={appointmentForm.email}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          email: e.target.value,
        })
      }
      required
    />

    <select
      value={appointmentForm.lesson}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          lesson: e.target.value,
        })
      }
      required
    >
      <option value="">Ders seçiniz</option>
      <option value="Gitar">Gitar</option>
      <option value="Piyano">Piyano</option>
      <option value="Bas Gitar">Bas Gitar</option>
      <option value="Müzik Teorisi">Müzik Teorisi</option>
      <option value="Çocuklar İçin Müzik">
        Çocuklar İçin Müzik
      </option>
    </select>

    <input
      type="date"
      value={appointmentForm.appointmentDate}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          appointmentDate: e.target.value,
        })
      }
      required
    />

 <select
  value={appointmentForm.appointmentTime}
  onChange={(e) =>
    setAppointmentForm({
      ...appointmentForm,
      appointmentTime: e.target.value,
    })
  }
  required
  disabled={
    !appointmentForm.appointmentDate ||
    isAppointmentAvailabilityLoading ||
    !isSelectedAppointmentDayOpen ||
    availableAppointmentTimes.length === 0
  }
>
  <option value="">
    {!appointmentForm.appointmentDate
      ? "Önce görüşme tarihi seç"
      : isAppointmentAvailabilityLoading
        ? "Saatler yükleniyor..."
        : !isSelectedAppointmentDayOpen
          ? "Seçilen gün ön görüşmeye kapalı"
          : availableAppointmentTimes.length === 0
            ? "Bu tarihte uygun saat bulunmuyor"
            : "Görüşme saati seç"}
  </option>

  {availableAppointmentTimes.map((time) => (
    <option key={time} value={time}>
      {time}
    </option>
  ))}
</select>

    <textarea
      placeholder="Eklemek istediğin bir not varsa yazabilirsin."
      value={appointmentForm.note}
      onChange={(e) =>
        setAppointmentForm({
          ...appointmentForm,
          note: e.target.value,
        })
      }
    />

    {appointmentFormStatus.message && (
      <p className={`form-message ${appointmentFormStatus.type}`}>
        {appointmentFormStatus.type === "success" && (
          <span className="success-icon">✓</span>
        )}

        {appointmentFormStatus.message}
      </p>
    )}

    <button
      type="submit"
      disabled={isAppointmentSubmitting}
    >
      {isAppointmentSubmitting
  ? "Ön görüşme gönderiliyor..."
  : "Ön Görüşme Talebi Gönder"}
    </button>
  </form>
</div>
  )}
</section>
      <div className="mobile-bottom-cta">
        <div className="mobile-bottom-cta-text">
          <span>Ders hakkında bilgi al</span>
<small>WhatsApp’tan hemen yaz</small>

        </div>

        <a
          href={buildBusinessWhatsAppLink("Merhaba, Eren Müzik Atölyesi hakkında bilgi almak istiyorum.")}
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