// BIP39 ∞ 1.0.0
const crypto = require('crypto');
const {
	assertWords,
	assertNumber,
	assertEntropy,
	assertWordlist,
	assertStrength,
	assertIsSet,
	assertChecksum
} = require('./deps/assert.cjs.js');
const {
	lpad,
	salt,
	range,
	chunk,
	normalize,
	binaryToByte,
	bytesToBinary,
	encodeMnemonicForSeedDerivation,
	deriveChecksumBits
} = require("./deps/utils.cjs.js");
const { wordlist } = require("./wordlists/wordlist.cjs.js");
const DEFAULT_WORDLIST = wordlist.bip39_eng;
/**
 * Generate x random words. Uses Cryptographically-Secure Random Number Generator.
 * @param strength mnemonic strength 128-256 bits
 * @param wordlist imported wordlist for specific language
 * @returns 12-24 words
 */
function generateMnemonic(strength, wordlist) {
	wordlist = wordlist || DEFAULT_WORDLIST;
	strength = strength || 128;
	assertStrength(strength);
	assertNumber(strength);
	assertIsSet(wordlist);
	if (strength % 32 !== 0 || strength > 256) 
		throw new TypeError(
			"Invalid entropy"
		)
	return entropyToMnemonic(crypto.getRandomValues( new Uint8Array(strength / 8 ) ), wordlist)
}
/**
 * Reversible: Converts raw entropy in form of byte array to mnemonic string.
 * @param entropy byte array
 * @param wordlist imported wordlist for specific language
 * @returns 12-24 words
 */
function entropyToMnemonic(entropy, wordlist) {
	wordlist = wordlist || DEFAULT_WORDLIST;
	assertIsSet(wordlist);
	assertEntropy(entropy);
	if (!wordlist) {
		throw new Error(
			`Provide the required wordlist`
		);
	}
	const entropyBits = bytesToBinary( entropy );
	const checksumBits = deriveChecksumBits(entropy);
	const words = chunk(entropyBits + checksumBits, 1, 11).map((binary) => wordlist[binaryToByte(binary)]);
	return words.join(' ').trim();
}
/**
 * Reversible: Converts mnemonic string to raw entropy in form of byte array.
 * 1. convert word indices to 11 bit binary strings
 * 2. split the binary string into ENT/CS
 * @param mnemonic 12-24 words
 * @param wordlist imported wordlist for specific language
 * @returns Uint8Array
 */
function mnemonicToEntropy(mnemonic, wordlist) {
	wordlist = wordlist || DEFAULT_WORDLIST;
	const words = normalize(mnemonic);
	assertIsSet(wordlist);
	assertWords(words)
	assertWordlist(words, wordlist);
	const bits = words.map((word) => lpad(wordlist.indexOf(word).toString(2), '0', 11) ).join(''); // 1
	const dividerIndex = Math.floor(bits.length / 33) * 32; // 2
	const entropyBits = bits.slice(0, dividerIndex);
	const checksumBits = bits.slice(dividerIndex);
	const entropyBytes = chunk(entropyBits, 1, 8).map( binaryToByte );
	var entropy = new Uint8Array(entropyBytes)
	const newChecksum = deriveChecksumBits(entropy);
	assertChecksum(newChecksum, checksumBits)
	if (newChecksum !== checksumBits) {
		throw new Error('Invalid checksum');
	}
	return entropy
}
/**
 * Validates mnemonic for being 12-24 words contained in `wordlist`.
 * @param mnemonic 12-24 words
 * @param wordlist imported wordlist for specific language
 */
function validateMnemonic(mnemonic, wordlist) {	
	try {
		mnemonicToEntropy(mnemonic)
	} catch (e) {
		return false
	}
	return true
}
/**
 * Irreversible (Sync/Async): Uses KDF to derive 64 bytes of key data from mnemonic + optional password.
 * @param mnemonic 12-24 words (string | Uint8Array)
 * @param wordlist imported wordlist for specific language
 * @param passphrase string that will additionally protect the key
 * @returns 64 bytes of key data
 */
function mnemonicToSeed(mnemonic, wordlist, passphrase = "", callback) {
	wordlist = wordlist || DEFAULT_WORDLIST;
	assertIsSet(wordlist);
	assertWords(mnemonic.split(' '))
	const encodedMnemonicUint8Array = encodeMnemonicForSeedDerivation(mnemonic, wordlist)
	crypto.pbkdf2( 
			encodedMnemonicUint8Array, 
			salt(passphrase), 
			2048, 
			64, 
			'sha512', 
		(err, derived) => {
			if (err) throw err; 
			callback( Buffer.from( new Uint8Array(derived) ).toString('hex') )
		}
	);
}
function mnemonicToSeedSync(mnemonic, wordlist, passphrase = "") {
	wordlist = wordlist || DEFAULT_WORDLIST;
	assertIsSet(wordlist);
	assertWords(mnemonic.split(' '))
	const encodedMnemonicUint8Array = encodeMnemonicForSeedDerivation(mnemonic, wordlist)
	var seed = crypto.pbkdf2Sync( 
		encodedMnemonicUint8Array, 
		salt(passphrase), 
		2048, 
		64, 
		'sha512' 
	)
	return Buffer.from( new Uint8Array( seed ) ).toString('hex')
}
/**
 * Generate array of valid checksum words given a mnemonic with invalid checksum
 * 1. Calculates the number of bits missing for entropy
 * 2. Converts mnemonic indexed number in BIP39 wordlist to binary
 * 3. Calculates all the possible permutations of missing bits for entropy
 * 4. Combines the binary representation of seed phrase with each possible missing bits to result in the possible entropy
 * 5. Inputs each mnem_pos in the SHA256 function to result in the corresponding checksum
 * 6. Combines the missing bits with its corresponding checksum
 * 7. Transforms 11 bit number to indexed number and then the corresponding word in the BIP39 wordlist
 * @param mnemonic 12-24 words (Array)
 * @param wordlist imported wordlist for specific language
 * @returns Array with valid checksum words
 */
function checksumWords(mnemonic, wordlist){
	assertIsSet(wordlist);
	var mnemlen = mnemonic.length;
	let ent_req_bits = Math.floor(11 - (1 / 3) * mnemlen); // 1
	let mnem_bin = mnemonic.map((word, inx) => mnemlen !== inx && wordlist.indexOf(word).toString(2).padStart(11, '0') ); // 2
	let ent_pos_bits = Array.from({ length: Math.pow(2, ent_req_bits) }, (_, x) => x.toString(2).padStart(ent_req_bits, '0')); // 3
	let mnem_pos = ent_pos_bits.map(bits => mnem_bin.slice(0, -1).join('') + bits); // 4
	var checksum = [];
	for (const entropy of mnem_pos) { // 5
		var entropyBytes = new Uint8Array( chunk(entropy, 1, 8).map( binaryToByte ) );
		var hashc = crypto.createHash('sha256').update(entropyBytes).digest()
		var hashRes = hashc[0].toString(2).padStart(8, '0')
		var dataSlice = hashRes.slice(0, 11 - ent_req_bits);
		checksum.push(dataSlice);
	}
	let lastWordBits = ent_pos_bits.map((bits, index) => bits + checksum[index]); // 6
	let lastWords = lastWordBits.map(bits => wordlist[parseInt(bits, 2)]); // 7
	return lastWords
}
module.exports = {
	generateMnemonic,
	mnemonicToEntropy,
	entropyToMnemonic,
	validateMnemonic,
	mnemonicToSeed,
	mnemonicToSeedSync,
	checksumWords
}