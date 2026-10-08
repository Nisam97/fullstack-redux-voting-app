import chai from 'chai';
import chaiImmutable from 'chai-immutable';

chai.use(chaiImmutable);

// The OTP request ceilings are per hour, which no test can wait out, and every
// request in this process arrives from the same client address. Raise the
// ceilings for the shared suite so a spec that is not about limiting is never
// refused; the hardening spec sets the real values back for its own cases, and
// host overrides in the environment are left alone.
process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL =
  process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL || '100000';
process.env.OTP_RATE_LIMIT_MAX_PER_IP =
  process.env.OTP_RATE_LIMIT_MAX_PER_IP || '100000';