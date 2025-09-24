const crypto = require('crypto');

const RULES = {
  MEGA_6_45: {
    code: 'MEGA_6_45',
    name: 'Vietlott Mega 6/45',
    numberCount: 6,
    min: 1,
    max: 45,
    allowDuplicates: false,
  },
  POWER_6_55: {
    code: 'POWER_6_55',
    name: 'Vietlott Power 6/55',
    numberCount: 6,
    min: 1,
    max: 55,
    allowDuplicates: false,
    extra: {
      name: 'Power Ball',
      numberCount: 1,
      min: 1,
      max: 45,
      allowDuplicates: false,
    },
  },
  TRADITIONAL_6D: {
    code: 'TRADITIONAL_6D',
    name: 'Xổ số truyền thống 6 chữ số',
    numberCount: 6,
    min: 0,
    max: 9,
    allowDuplicates: true,
  },
};

function randomInt(min, max) {
  return Math.floor(crypto.randomInt(min, max + 1));
}

function generateSingle(rule, options) {
  if (!rule.allowDuplicates) {
    const set = new Set();
    while (set.size < rule.numberCount) {
      set.add(randomInt(rule.min, rule.max));
    }
    const arr = Array.from(set).sort((a, b) => a - b);
    if (options.avoidConsecutiveDuplicates) {
      for (let i = 1; i < arr.length; i += 1) {
        if (arr[i] === arr[i - 1]) {
          return generateSingle(rule, options);
        }
      }
    }
    return arr;
  }
  const numbers = [];
  while (numbers.length < rule.numberCount) {
    const value = randomInt(rule.min, rule.max);
    if (options.avoidConsecutiveDuplicates && numbers.length && numbers[numbers.length - 1] === value) {
      continue;
    }
    numbers.push(value);
  }
  return numbers;
}

function generateNumbers(rule, options) {
  const results = [];
  for (let i = 0; i < options.quantity; i += 1) {
    const main = generateSingle(rule, options);
    if (rule.extra) {
      results.push({ main, extra: generateSingle(rule.extra, options) });
    } else {
      results.push(main);
    }
  }
  return results;
}

function getRule(code) {
  return RULES[code];
}

module.exports = { generateNumbers, getRule, RULES };
