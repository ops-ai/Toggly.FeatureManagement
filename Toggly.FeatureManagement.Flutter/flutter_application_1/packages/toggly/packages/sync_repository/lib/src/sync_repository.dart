import 'dart:async';

class SyncRepository {
  static final SyncRepository _instance = SyncRepository._internal();

  Timer? paymentConfirmationTimer;
  Timer? cashPaymentAnimationTimer;
  Timer? qrGenerationTimer;
  Timer? ordersTimer;

  SyncRepository._internal() {}

  static SyncRepository get getInstance => _instance;
}
