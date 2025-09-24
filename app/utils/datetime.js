function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function addMinutes(date, minutes) {
  return addSeconds(date, minutes * 60);
}

function subMinutes(date, minutes) {
  return addSeconds(date, -minutes * 60);
}

function subDays(date, days) {
  return addSeconds(date, -days * 86400);
}

function differenceInSeconds(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / 1000);
}

module.exports = { addSeconds, addMinutes, subMinutes, subDays, differenceInSeconds };
