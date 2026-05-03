import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

export const hasFirebaseWebConfig = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let auth;

const getFirebaseAuth = () => {
  if (!hasFirebaseWebConfig) {
    return null;
  }

  if (!auth) {
    auth = getAuth(initializeApp(firebaseConfig));
  }

  return auth;
};

const normalizePhoneForFirebase = (phone = "") => {
  const cleanPhone = String(phone).replace(/[^\d+]/g, "");

  if (cleanPhone.startsWith("+")) {
    return cleanPhone;
  }

  if (cleanPhone.length === 10) {
    return `+91${cleanPhone}`;
  }

  return `+${cleanPhone}`;
};

export const sendFirebaseOtp = async (phone) => {
  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth) {
    throw new Error("Firebase web config is missing.");
  }

  if (window.batchmarkRecaptchaVerifier) {
    window.batchmarkRecaptchaVerifier.clear();
  }

  window.batchmarkRecaptchaVerifier = new RecaptchaVerifier(
    firebaseAuth,
    "firebase-recaptcha",
    {
      size: "invisible",
    }
  );

  return signInWithPhoneNumber(
    firebaseAuth,
    normalizePhoneForFirebase(phone),
    window.batchmarkRecaptchaVerifier
  );
};
