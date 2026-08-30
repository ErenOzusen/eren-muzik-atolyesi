export function getSubmissionDate(submission) {
  return submission?.date || submission?.createdAt || null;
}

export function normalizeLessonName(lesson) {
  return (lesson || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getLessonStatCategory(lesson) {
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

export function computeSubmissionStats(submissions) {
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
