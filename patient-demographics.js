export const sexLabels = { male: 'ชาย', female: 'หญิง', other: 'อื่น ๆ' };

export function ageInYears(age) {
  return age == null || age === '' ? '' : `${age} ปี`;
}
