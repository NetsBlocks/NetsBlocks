require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const { dec2Bin, printBinary, ensureNBits, asciiToBits, chopString, binaryToAsciiChar } = require('./utils');

/*
* fiestel block encryption helper
* relies heavily on javascripts charCodeAt and fromCharCode.
* assumes 8bit ascii alphabet
*/
class BlockCipher {
  /*
  * @param {Number} n word size in bits
  * @param {Number} m number of keywords
  */
  constructor(n, m, numRounds) {
    if (!n || !m || !numRounds) throw new Error('missing initialization parameters');
    console.log(`creating block cipher with block size: ${2*n} key size: ${m*n}`);
    this.m = m;
    this.n = n;
    this.numRounds = numRounds;
    this.MAX_KEY = Math.pow(2, m * n);
    this.MAX_WORD = Math.pow(2, n);
    this.ALPHABET_SIZE = 8;
  }

  _checkKeyWords(keyWords) {
    if (!Array.isArray(keyWords) || keyWords.length !== this.m) throw new Error('bad key words');
    keyWords.forEach(key => {
      if (isNaN(key) || key > this.MAX_WORD) throw new Error('bad key word', key);
    })
  }

  /*
  * @param {Array<Number>} keyWords a list of key words containing numbers up to word size
  * @returns {Array<Number>} round keys: a list of round keys
  */
  _expandKey(keyWords) {
    this._checkKeyWords(keyWords);
    // override
  }

  /*
  * @param {Array<Number>} words a list of 2 words (a block)
  * @param {Array<Number>} rKeys: a list of round keys
  */
  _encrypt(words, rKeys) {
    // override
    throw new Error('not implemented');
  }

  /*
  * @param {Array<Number>} words a list of 2 words (a block)
  * @param {Array<Number>} rKeys: a list of round keys
  */
  _decrypt(words, rKeys) {
    // override
    throw new Error('not implemented');
  }

  /*
  * converts text to word sized integer blocks
  * @param {string} text ascii text to encrypt (8bit encoded)
  */
  _textToNumericBlocks(text) {
    // prepare the text
    let bits = asciiToBits(text);
    // console.log(bits);
    let inputWords = chopString(bits, this.n)
      .map(word => parseInt(word, 2));
    // console.log('input words', inputWords);

    // account for odd number of words
    if (inputWords.length % 2 !== 0) inputWords.push(0);

    let blocks = []
    while (inputWords.length) {
      blocks.push([inputWords.shift(), inputWords.shift()]);
    }
    return blocks;
  }

  /*
  * converts word sized integer blocks to text
  * WARN drops null characters \u0000
  * @param {Array<Number>} encWords converts a list of word integers into text
  * @param {Boolean=} removeNulls determines if the null characters should be removed in the process
  */
  _numericBlocksToText(intWords, removeNulls=false) {
    const NULL_CHAR = new Array(this.ALPHABET_SIZE).fill(0).join(''); // initially generated by padding small numbers
    // ensure each word is alphabet size
    let bitsStr =  intWords
      .map(w => dec2Bin(w)) // convert to bin string repr
      .map(w => ensureNBits(w, this.n))
      .join('');

    // convert it back to ascii
    console.assert(bitsStr.length % this.ALPHABET_SIZE === 0);
    let charBitBuckets =  chopString(bitsStr, this.ALPHABET_SIZE);
    if (removeNulls) charBitBuckets = charBitBuckets.filter(charBits => charBits !== NULL_CHAR);

    return charBitBuckets.map(binaryChar => binaryToAsciiChar(binaryChar))
      .join('');
  }

  /*
  * @param {string} text ascii text to encrypt (8bit encoded)
  * @param {Array<Number>} keyWords a list of key words containing numbers up to word size
  */
  encryptAscii(text, keyWords) {
    if (text === undefined) throw new Error('bad input');

    // prepare the round keys
    let roundKeys = this._expandKey(keyWords);
    // console.log(roundKeys);

    let encWords = [];
    let blocks = this._textToNumericBlocks(text);
    blocks.forEach(block => {
      const [encX, encY] = this._encrypt(block, roundKeys);
      if (encX > this.MAX_WORD || encY > this.MAX_WORD) throw new Error('encryptiong returned too big a number');
      encWords.push(encX, encY);
    })

    return this._numericBlocksToText(encWords);
  }

  /*
  * @param {string} text ascii text to encrypt (8bit encoded)
  * @param {Array<Number>} keyWords a list of key words containing numbers each up to word size
  */
  decryptAscii(text, keyWords) {
    if (text === undefined) throw new Error('bad input');

    // prepare the round keys
    let roundKeys = this._expandKey(keyWords);
    // console.log(roundKeys);

    let encWords = [];
    let blocks = this._textToNumericBlocks(text);
    blocks.forEach(block => {
      const [decX, decY] = this._decrypt(block, roundKeys);
      if (decX > this.MAX_WORD || decY > this.MAX_WORD) throw new Error('encryptiong returned too big a number');
      encWords.push(decX, decY);
    })
    // console.log('enc words', encWords);

    return this._numericBlocksToText(encWords, true);
  }
}

module.exports = BlockCipher;

},{"./utils":"utils"}],"speck3264":[function(require,module,exports){
const { printBinary, mod, lcsn, rcsn, asciiToBits, chopString } = require('../utils'),
  BlockCipher = require('../blockCipher');

class SpeckNative32 extends BlockCipher {
  constructor() {
    super(16, 4, 22);
    this.alpha = 7;
    this.beta = 2;
  }

  _expandKey(keyWords) {
    super._expandKey(keyWords);
    let rKeys = [];
    // build the initial L and K CHECK
    const m = this.m;
    const sixteenOnes = Math.pow(2,16) - 1;

    let key = [...keyWords]; // shallow copy to dereference
    var k = key[3];
    for (var i = 0, j; i < this.numRounds; ++i) {
        rKeys[i] = k;
        j = 2 - i % 3;
        key[j] = rcsn(key[j], 7, 16) + k & sixteenOnes ^ i;
        k = lcsn(k, 2, 16) ^ key[j];
    }

    return rKeys;
  }

  _round(x, y, rKey) {
    // calc x
    let leftTerm = mod(rcsn(x, this.alpha, 16) + y, Math.pow(2, this.n)); // modulo addition
    // CHECK override x here?
    x = leftTerm ^ rKey;
    y = lcsn(y, this.beta, 16) ^ x;

    return [x, y];
  }

  // inverse round
  _roundI(x, y, rKey) {
    y = rcsn(x ^ y, this.beta, 16);
    let leftT = mod((x ^ rKey) - y, Math.pow(2, this.n)); // modulo subtraction
    x = lcsn(leftT, this.alpha, 16);
    return [x, y];
  }

  // input: 2 words (a block) and a list of round keys
  _encrypt(words, rKeys) {
    // console.log('input words to encrypt', words);
    let [x, y] = words;
    for (let i=0; i<this.numRounds; i++) {
      [x, y] = this._round(x, y, rKeys[i]);
    }
    return [x, y];
  }

  _decrypt(words, rKeys) {
    // console.log('input words to decrypt', words);
    let [x, y] = words;
    for (let i=this.numRounds-1; i >= 0; i--) {
      [x, y] = this._roundI(x, y, rKeys[i]);
    }
    return [x, y];
  }
}

module.exports = SpeckNative32;

},{"../blockCipher":1,"../utils":"utils"}],"utils":[function(require,module,exports){
// js int length for bitwise operations (in form of two's complement)
const JSINTLENGTH = 32;
const ASCII_SIZE = 8;

// WARN positive dec
let dec2Bin = dec => {
  return (dec >>> 0).toString(2);
}

// ensure binary string is n bits
let ensureNBits = (str, n) => {
  diff = n - str.length;
  if (diff < 0) throw new Error(`input binary out of the defined alphabet range ${str.length} vs ${n}`);
  console.assert(diff >= 0);
  if (diff > 0) {
    let pad = '';
    for (let i=0; i < diff; i++) {
      pad += '0';
    }
    str = pad + str;
  }
  return str;
};


// padded string repr of num
let asciiCharToBinary =  c => {
  let decNum = c.charCodeAt(0); // CHECK UTF16 but also ASCII ?!
  let numStr = dec2Bin(decNum);
  numStr = ensureNBits(numStr, ASCII_SIZE);
  return numStr;
};

let binaryToAsciiChar =  binaryStr => {
  if (binaryStr.length !== ASCII_SIZE) throw new Error(`input has to be ${ASCII_SIZE} bits`);
  let c = String.fromCharCode(parseInt(binaryStr, 2));
  return c;
};


let printBinary = int => {
  let str = int.toString(2);
  return str;
};

let lcs = (xInt, nBits) => {
  if (nBits === undefined) throw new Error('missing input: number of bits to shift is required');
  let res = (xInt << nBits | xInt >>> JSINTLENGTH-nBits)
  return res;
};

let rcs = (xInt, nBits) => {
  if (nBits === undefined) throw new Error('missing input: number of bits to shift is required');
  let res = (xInt << JSINTLENGTH-nBits | xInt >>> nBits)
  return res;
};

let lcsn = (xInt, nBits, unsignedBitCount) => {
  if (nBits === undefined) throw new Error('missing input: number of bits to shift is required');
  if (unsignedBitCount > 32 || unsignedBitCount < 1) throw new Error('bad number size')
  let res = (xInt << nBits | xInt >>> unsignedBitCount-nBits) & (Math.pow(2, unsignedBitCount) - 1)
  return res;
};

let rcsn = (xInt, nBits, unsignedBitCount) => {
  if (nBits === undefined) throw new Error('missing input: number of bits to shift is required');
  if (unsignedBitCount > 32 || unsignedBitCount < 1) throw new Error('bad number size')
  let res = (xInt << unsignedBitCount-nBits | xInt >>> nBits) & (Math.pow(2, unsignedBitCount) - 1)
  return res;
};

// FIXME there should be a way of avoiding strings..
let asciiToBits = str => {
  let bitRep = '';
  for (var n = 0, l = str.length; n < l; n ++)
  {
    bitRep += asciiCharToBinary(str[n]);
  }
  return bitRep;
};

let chopString = (str, blockSize) => {
  let re = new RegExp(`.{1,${blockSize}}`, 'g');
  return str.match(re);
};

/**
 * Computes x mod n
 * x arbitrary integer
 * n natural number
 */
const mod = (x, n) => ((x % n) + n) % n;
// const mod = (x, n) => x & n;

// (a+b) mod c = (a mod c + b mod c) mod c
let moduloAdd = (a, b, base) => {
  return mod((a + b), base);
}

let moduloSub = (a, b, base) => {
  return mod((a - b), base);
}

module.exports = {
  lcs,
  rcs,
  lcsn,
  rcsn,
  moduloAdd,
  moduloSub,
  lcs16: (xInt, nBits) => lcsn(xInt, nBits, 16),
  rcs16: (xInt, nBits) => rcsn(xInt, nBits, 16),
  printBinary,
  asciiToBits,
  asciiCharToBinary,
  binaryToAsciiChar,
  ensureNBits,
  dec2Bin,
  chopString,
  mod,
}

},{}]},{},[]);