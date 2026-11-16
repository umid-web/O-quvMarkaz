export const normalizeCourseText = (value) => String(value || '').trim().replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('uz');

// Course names (IELTS/CEFR) and subjects (Ingliz tili) are different labels.
export function matchingStudentGroups(query, courses, groups) {
  const text = normalizeCourseText(query);
  if (!text) return [];
  const matchingNames = new Set(courses.filter((course) => course.status !== 'archived'
    && [course.name, course.subject].some((value) => normalizeCourseText(value) === text))
    .map((course) => normalizeCourseText(course.name)));
  return groups.filter((group) => group.status !== 'archived'
    && (normalizeCourseText(group.course) === text || matchingNames.has(normalizeCourseText(group.course))));
}

export function matchesCourse(person, name, courses) {
  const course = courses.find((item) => item.name === name);
  return person.subjects.some((subject) => [name, course?.subject].some(
    (label) => label && normalizeCourseText(label) === normalizeCourseText(subject)));
}

export const activeCourseNames = (courses) => [...new Set(courses
  .filter((course) => course.status !== 'archived')
  .map((course) => course.name).filter(Boolean))];
