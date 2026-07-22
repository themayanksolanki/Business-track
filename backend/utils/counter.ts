import Counter from '../models/Counter.js';

export const getNextSequence = async (name: string): Promise<number> => {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  // upsert: true guarantees a document — mongoose's return type just doesn't
  // know that from the options object.
  return counter!.seq;
};
