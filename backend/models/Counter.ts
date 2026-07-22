import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface CounterDocument extends Document<string> {
  seq: number;
}

const counterSchema = new Schema<CounterDocument>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter: Model<CounterDocument> = mongoose.model<CounterDocument>('Counter', counterSchema);

export default Counter;
