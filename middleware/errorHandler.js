export const errorHandler = (err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Enterprise Server Error',
    timestamp: new Date().toISOString()
  });
};
