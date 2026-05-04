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
const RECAPTCHA_CONTAINER_ID = "firebase-recaptcha";

const resetRecaptchaContainer = () => {
  if (window.batchmarkRecaptchaVerifier) {
    try {
      window.batchmarkRecaptchaVerifier.clear();
    } catch (err) {
      console.warn("Could not clear Firebase reCAPTCHA verifier", err);
    }

    window.batchmarkRecaptchaVerifier = null;
  }

  const container = document.getElementById(RECAPTCHA_CONTAINER_ID);

  if (container) {
    container.innerHTML = "";
  }
};

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

  resetRecaptchaContainer();

  window.batchmarkRecaptchaVerifier = new RecaptchaVerifier(
    firebaseAuth,
    RECAPTCHA_CONTAINER_ID,
    {
      size: "invisible",
    }
  );

  try {
    return await signInWithPhoneNumber(
      firebaseAuth,
      normalizePhoneForFirebase(phone),
      window.batchmarkRecaptchaVerifier
    );
  } catch (err) {
    resetRecaptchaContainer();
    throw err;
  }
};
