import 'reflect-metadata';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TogglyModule, FeatureFlag, FeatureFlagGuard, FeatureEnabled } from '@ops-ai/toggly-nestjs';
@Controller()
class ExampleController {
  @Get('dashboard')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlag('new-dashboard')
  dashboard(@FeatureEnabled('enhanced-submit') enhanced: boolean) {
    return { enhanced };
  }
}
@Module({
  imports: [
    TogglyModule.forRoot({
      appKey: process.env.TOGGLY_APP_KEY,
      verifySignatures: true,
      featureDefaults: { 'new-dashboard': false },
    }),
  ],
  controllers: [ExampleController],
})
class ExampleModule {}
const app = await NestFactory.create(ExampleModule);
app.enableShutdownHooks();
await app.listen(3000);
