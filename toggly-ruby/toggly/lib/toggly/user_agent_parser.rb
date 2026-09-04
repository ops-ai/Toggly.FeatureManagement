# frozen_string_literal: true

module Toggly
  # Best-effort User-Agent parse result for segment filters.
  class ParsedUserAgent
    # @return [String]
    attr_reader :browser_family, :os_family, :device_family

    def initialize(browser_family:, os_family:, device_family:)
      @browser_family = browser_family
      @os_family = os_family
      @device_family = device_family
    end
  end

  # Best-effort UA parsing (parity with toggly-eval / Java / Python).
  module UserAgentParser
    module_function

    # @param user_agent [String, nil]
    # @return [ParsedUserAgent, nil]
    def parse(user_agent)
      return nil if user_agent.nil? || user_agent.empty?

      ParsedUserAgent.new(
        browser_family: detect_browser(user_agent),
        os_family: detect_os(user_agent),
        device_family: detect_device(user_agent)
      )
    end

    def detect_browser(user_agent)
      return "Edge" if user_agent.include?("Edg/") || user_agent.include?("EdgiOS/")
      return "Opera" if user_agent.include?("OPR/") || user_agent.include?("Opera")
      return "Chrome" if user_agent.include?("Chrome/") || user_agent.include?("CriOS/")
      return "Firefox" if user_agent.include?("Firefox/") || user_agent.include?("FxiOS/")
      if user_agent.include?("Safari/") && user_agent.include?("Version/") &&
         !user_agent.include?("Chrome") && !user_agent.include?("Chromium")
        return "Safari"
      end

      "Other"
    end
    module_function :detect_browser

    def detect_os(user_agent)
      return "Android" if user_agent.include?("Android")
      if user_agent.include?("iPhone") || user_agent.include?("iPad") || user_agent.include?("iPod") ||
         user_agent.include?("CPU iPhone OS") || user_agent.include?("CPU OS")
        return "iOS"
      end
      return "Mac OS" if user_agent.include?("Mac OS X") || user_agent.include?("Macintosh")
      return "Windows" if user_agent.include?("Windows")
      return "Linux" if user_agent.include?("Linux")

      "Other"
    end
    module_function :detect_os

    def detect_device(user_agent)
      return "iPhone" if user_agent.include?("iPhone")
      return "iPad" if user_agent.include?("iPad")
      return "iPod" if user_agent.include?("iPod")

      "Other"
    end
    module_function :detect_device
  end
end
