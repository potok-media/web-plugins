FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /source

COPY plugin/ plugin/
COPY src/OnlineBalancers/OnlineBalancers.csproj src/OnlineBalancers/
RUN dotnet restore src/OnlineBalancers/OnlineBalancers.csproj

COPY src/OnlineBalancers/ src/OnlineBalancers/
RUN dotnet publish src/OnlineBalancers/OnlineBalancers.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish/ ./
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "OnlineBalancers.dll", "--urls", "http://0.0.0.0:8080"]
