const mongoose = require("mongoose");
const Label = require("../models/Label");
const User = require("../models/User");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/labels";

const hasFirebaseConfig = () =>
  Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      (process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY)
  );

const parseServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
    );
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
};

let firebaseDb = null;
let admin = null;

const toSerializableDate = (value) => {
  if (!value) {
    return value;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  return value;
};

const fromFirebaseDoc = (doc) => {
  if (!doc.exists) {
    return null;
  }

  const data = doc.data() || {};

  return {
    _id: doc.id,
    ...data,
    createdAt: toSerializableDate(data.createdAt),
    updatedAt: toSerializableDate(data.updatedAt),
  };
};

const getFirebaseDb = () => {
  if (firebaseDb) {
    return firebaseDb;
  }

  admin = require("firebase-admin");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(parseServiceAccount()),
    });
  }

  firebaseDb = admin.firestore();
  return firebaseDb;
};

const connectDatabase = async () => {
  if (hasFirebaseConfig()) {
    getFirebaseDb();
    console.log("Firebase Firestore connected");
    return;
  }

  mongoose.set("bufferCommands", false);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("MongoDB connected");
};

const serverTimestamp = () =>
  admin ? admin.firestore.FieldValue.serverTimestamp() : new Date();

const labelStore = {
  async list() {
    if (hasFirebaseConfig()) {
      const snapshot = await getFirebaseDb()
        .collection("labels")
        .orderBy("createdAt", "desc")
        .limit(500)
        .get();

      return snapshot.docs.map(fromFirebaseDoc);
    }

    return Label.find().sort({ _id: -1 }).limit(500).lean();
  },

  async getById(id) {
    if (hasFirebaseConfig()) {
      const doc = await getFirebaseDb().collection("labels").doc(id).get();
      return fromFirebaseDoc(doc);
    }

    return Label.findById(id).lean();
  },

  async create(data) {
    if (hasFirebaseConfig()) {
      const now = serverTimestamp();
      const ref = await getFirebaseDb()
        .collection("labels")
        .add({
          ...data,
          createdAt: now,
          updatedAt: now,
        });

      return {
        _id: ref.id,
        ...data,
      };
    }

    return Label.create(data);
  },

  async deleteById(id) {
    if (hasFirebaseConfig()) {
      const ref = getFirebaseDb().collection("labels").doc(id);
      const doc = await ref.get();

      if (!doc.exists) {
        return null;
      }

      await ref.delete();
      return fromFirebaseDoc(doc);
    }

    return Label.findByIdAndDelete(id).lean();
  },
};

const userStore = {
  async getByPhone(phone) {
    if (hasFirebaseConfig()) {
      const doc = await getFirebaseDb().collection("users").doc(phone).get();
      return fromFirebaseDoc(doc);
    }

    return User.findOne({ phone }).lean();
  },

  async saveLogin(phone, name) {
    if (hasFirebaseConfig()) {
      const ref = getFirebaseDb().collection("users").doc(phone);
      const doc = await ref.get();
      const now = serverTimestamp();
      const current = doc.exists ? doc.data() : {};
      const user = {
        phone,
        manufacturer: current.manufacturer || name || phone,
        manufacturerPhone: current.manufacturerPhone || phone,
        ...current,
        name: name || current.name || phone,
        updatedAt: now,
        createdAt: current.createdAt || now,
      };

      await ref.set(user, { merge: true });
      return { _id: phone, ...user };
    }

    return User.findOneAndUpdate(
      { phone },
      {
        $setOnInsert: {
          phone,
          manufacturer: name || phone,
          manufacturerPhone: phone,
        },
        $set: {
          name: name || phone,
        },
      },
      { returnDocument: "after", upsert: true }
    ).lean();
  },

  async saveProfile(phone, fields) {
    if (hasFirebaseConfig()) {
      const ref = getFirebaseDb().collection("users").doc(phone);
      const doc = await ref.get();
      const now = serverTimestamp();
      const data = {
        phone,
        ...fields,
        manufacturerPhone: fields.manufacturerPhone || phone,
        updatedAt: now,
        createdAt: doc.exists ? doc.data().createdAt || now : now,
      };

      await ref.set(data, { merge: true });
      return { _id: phone, ...fromFirebaseDoc(await ref.get()) };
    }

    return User.findOneAndUpdate(
      { phone },
      {
        $set: {
          phone,
          ...fields,
          manufacturerPhone: fields.manufacturerPhone || phone,
        },
      },
      { returnDocument: "after", upsert: true }
    ).lean();
  },
};

module.exports = {
  connectDatabase,
  labelStore,
  userStore,
};
