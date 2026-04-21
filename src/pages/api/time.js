export default function handler(req, res) {
  res.status(200).json({ serverTime: Date.now() });
}
