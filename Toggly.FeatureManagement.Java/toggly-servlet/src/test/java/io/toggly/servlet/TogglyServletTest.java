package io.toggly.servlet;

import io.toggly.core.TogglyClient;
import jakarta.servlet.ServletContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TogglyServletTest {

    @Test
    void returnsServiceUnavailableWhenNoClientIsConfigured() throws Exception {
        HttpServletRequest request = request(null, null);
        ResponseCapture response = new ResponseCapture();

        new TestServlet().get(request, response.response);

        verify(response.response).setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        assertEquals("{\"error\":\"Toggly not configured\"}", response.body());
    }

    @Test
    void returnsAllFeatureStatesAtTheRootEndpoint() throws Exception {
        TogglyClient client = mock(TogglyClient.class);
        Map<String, Boolean> features = new LinkedHashMap<>();
        features.put("alpha", true);
        features.put("beta", false);
        when(client.evaluateAll(org.mockito.ArgumentMatchers.any())).thenReturn(features);
        ResponseCapture response = new ResponseCapture();

        new TestServlet().get(request(client, "/"), response.response);

        verify(response.response).setContentType("application/json");
        verify(response.response).setCharacterEncoding("UTF-8");
        assertEquals("{\"features\":{\"alpha\":true,\"beta\":false},\"count\":2}", response.body());
    }

    @Test
    void reportsUnknownFeaturesWithoutAFilterCount() throws Exception {
        TogglyClient client = mock(TogglyClient.class);
        when(client.isEnabled(org.mockito.ArgumentMatchers.eq("missing"), org.mockito.ArgumentMatchers.any())).thenReturn(false);
        ResponseCapture response = new ResponseCapture();

        new TestServlet().get(request(client, "/missing"), response.response);

        assertEquals("{\"key\":\"missing\",\"enabled\":false,\"exists\":false}", response.body());
    }

    @Test
    void refreshesDefinitionsFromTheRefreshEndpoint() throws Exception {
        TogglyClient client = mock(TogglyClient.class);
        when(client.getFeatureKeys()).thenReturn(Set.of("alpha"));
        ResponseCapture response = new ResponseCapture();

        new TestServlet().post(request(client, "/refresh"), response.response);

        verify(client).refresh();
        assertEquals("{\"status\":\"refreshed\",\"featureCount\":1}", response.body());
    }

    @Test
    void rejectsUnknownPostEndpoints() throws Exception {
        ResponseCapture response = new ResponseCapture();

        new TestServlet().post(request(mock(TogglyClient.class), "/other"), response.response);

        verify(response.response).setStatus(HttpServletResponse.SC_NOT_FOUND);
        assertEquals("{\"error\":\"Unknown endpoint\"}", response.body());
    }

    private HttpServletRequest request(TogglyClient client, String pathInfo) {
        ServletContext context = mock(ServletContext.class);
        when(context.getAttribute(TogglyServletContextListener.TOGGLY_CLIENT_ATTR)).thenReturn(client);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getServletContext()).thenReturn(context);
        when(request.getPathInfo()).thenReturn(pathInfo);
        return request;
    }

    private static final class TestServlet extends TogglyServlet {
        void get(HttpServletRequest request, HttpServletResponse response) throws Exception {
            doGet(request, response);
        }

        void post(HttpServletRequest request, HttpServletResponse response) throws Exception {
            doPost(request, response);
        }
    }

    private static final class ResponseCapture {
        private final StringWriter writer = new StringWriter();
        private final HttpServletResponse response = mock(HttpServletResponse.class);

        private ResponseCapture() throws Exception {
            when(response.getWriter()).thenReturn(new PrintWriter(writer));
        }

        private String body() {
            return writer.toString();
        }
    }
}
