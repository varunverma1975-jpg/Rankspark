import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'rs-test',
  firestore: { host: '127.0.0.1', port: 8080,
    rules: fs.readFileSync('/home/user/admin/firestore.rules', 'utf8') }
});

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' :: ' + (e.message || '').slice(0, 90)); fail++; }
};

// Seed: one admin, two users, a draft + live book
await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  await setDoc(doc(d, 'admins/admin1'), { email: 'a@x.com', role: 'owner' });
  await setDoc(doc(d, 'users/alice'), { plan: 'spark', status: 'active', profile: { displayName: 'Alice' } });
  await setDoc(doc(d, 'users/bob'), { plan: 'blaze', status: 'active' });
  await setDoc(doc(d, 'books/live1'), { name: 'Live book', active: true });
  await setDoc(doc(d, 'books/draft1'), { name: 'Draft book', active: false });
  await setDoc(doc(d, 'config/app'), { maintenance: { enabled: false } });
  await setDoc(doc(d, 'content/privacy'), { status: 'published', body: 'x' });
  await setDoc(doc(d, 'content/faq'), { status: 'draft', body: 'y' });
  await setDoc(doc(d, 'payments/p1'), { uid: 'alice', amount: 149 });
  await setDoc(doc(d, 'auditLog/l1'), { adminUid: 'admin1', action: 'x' });
});

const admin = env.authenticatedContext('admin1').firestore();
const alice = env.authenticatedContext('alice').firestore();
const anon  = env.unauthenticatedContext().firestore();

console.log('\n== students cannot escalate ==');
await t('student CANNOT publish a book',      () => assertFails(setDoc(doc(alice,'books/live1'),{active:true},{merge:true})));
await t('student CANNOT edit pricing',        () => assertFails(setDoc(doc(alice,'config/pricing'),{plans:[]})));
await t('student CANNOT enable maintenance',  () => assertFails(setDoc(doc(alice,'config/app'),{maintenance:{enabled:true}},{merge:true})));
await t('student CANNOT grant self a plan',   () => assertFails(updateDoc(doc(alice,'users/alice'),{plan:'inferno'})));
await t('student CANNOT lift own suspension', () => assertFails(updateDoc(doc(alice,'users/alice'),{status:'active',plan:'inferno'})));
await t('student CANNOT read another user',   () => assertFails(getDoc(doc(alice,'users/bob'))));
await t('student CANNOT become admin',        () => assertFails(setDoc(doc(alice,'admins/alice'),{role:'owner'})));
await t('student CANNOT fabricate a payment', () => assertFails(setDoc(doc(alice,'payments/fake'),{amount:99999})));
await t('student CANNOT read draft book',     () => assertFails(getDoc(doc(alice,'books/draft1'))));
await t('student CANNOT read draft content',  () => assertFails(getDoc(doc(alice,'content/faq'))));
await t('student CANNOT read audit log',      () => assertFails(getDoc(doc(alice,'auditLog/l1'))));

console.log('\n== students can do their own work ==');
await t('student CAN read own doc',           () => assertSucceeds(getDoc(doc(alice,'users/alice'))));
await t('student CAN update own safe fields', () => assertSucceeds(updateDoc(doc(alice,'users/alice'),{'profile.displayName':'Alice2'})));
await t('student CAN read live book',         () => assertSucceeds(getDoc(doc(alice,'books/live1'))));
await t('student CAN read own payment',       () => assertSucceeds(getDoc(doc(alice,'payments/p1'))));
await t('student CAN submit ranked attempt',  () => assertSucceeds(setDoc(doc(alice,'rankedAttempts/alice_1'),{uid:'alice',score:10})));
await t('attempt is immutable after write',   () => assertFails(updateDoc(doc(alice,'rankedAttempts/alice_1'),{score:999})));
await t('student CANNOT spoof another uid',   () => assertFails(setDoc(doc(alice,'rankedAttempts/x'),{uid:'bob',score:10})));

console.log('\n== guests ==');
await t('guest CAN read config (pre-login)',  () => assertSucceeds(getDoc(doc(anon,'config/app'))));
await t('guest CAN read banners',             () => assertSucceeds(getDoc(doc(anon,'messages/m1'))));
await t('guest CAN read published content',   () => assertSucceeds(getDoc(doc(anon,'content/privacy'))));
await t('guest CANNOT write config',          () => assertFails(setDoc(doc(anon,'config/app'),{x:1},{merge:true})));
await t('guest CANNOT read users',            () => assertFails(getDoc(doc(anon,'users/alice'))));

console.log('\n== admins ==');
await t('admin CAN publish a book',           () => assertSucceeds(setDoc(doc(admin,'books/draft1'),{active:true},{merge:true})));
await t('admin CAN edit pricing',             () => assertSucceeds(setDoc(doc(admin,'config/pricing'),{plans:[]})));
await t('admin CAN read any user',            () => assertSucceeds(getDoc(doc(admin,'users/alice'))));
await t('admin CAN override a plan',          () => assertSucceeds(updateDoc(doc(admin,'users/alice'),{plan:'inferno'})));
await t('admin CAN write audit entry',        () => assertSucceeds(addDoc(collection(admin,'auditLog'),{adminUid:'admin1',action:'test',target:'t'})));
await t('admin CANNOT forge another adminUid',() => assertFails(addDoc(collection(admin,'auditLog'),{adminUid:'someoneelse',action:'x',target:'t'})));
await t('admin CANNOT edit audit history',    () => assertFails(updateDoc(doc(admin,'auditLog/l1'),{action:'covered up'})));
await t('admin CANNOT delete audit history',  () => assertFails(deleteDoc(doc(admin,'auditLog/l1'))));
await t('admin CANNOT mint admins directly',  () => assertFails(setDoc(doc(admin,'admins/newguy'),{role:'admin'})));
await t('admin CANNOT fabricate a payment',   () => assertFails(setDoc(doc(admin,'payments/fake'),{amount:1})));

console.log('\n== unknown collection is denied by default ==');
await t('undeclared collection denied',       () => assertFails(setDoc(doc(admin,'somethingNew/x'),{a:1})));

await env.cleanup();
console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
