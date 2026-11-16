export const parseSubjects = (text) => {
  const subjects = new Map();
  for (const part of text.split(/[,;\n]/)) {
    const name = part.trim();
    if (name && !subjects.has(name.toLocaleLowerCase('uz'))) subjects.set(name.toLocaleLowerCase('uz'), name);
  }
  return [...subjects.values()];
};

// Subject labels describe expertise, not which course names may be assigned.
export const eligiblePeople = (people) => people.filter((person) => person.status !== 'left');
